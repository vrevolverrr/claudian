import { randomUUID } from 'node:crypto';

import {
  type ProviderExecutionEvent,
  type ProviderExecutionRequest,
  type ProviderExecutionRun,
  type ProviderExecutionSession,
  type ProviderRequestedEventScope,
  type ProviderSessionConfig,
  type ProviderSessionEvent,
  type ProviderSessionEventScope,
  type ProviderSessionInvalidation,
  type ProviderSessionSnapshot,
  type ProviderSessionStatus,
} from '../../../core/execution';
import { ManagedStdioProcess } from '../../../core/process/ManagedStdioProcess';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import type { ChatMessage } from '../../../core/types';
import {
  appendContextFiles,
  appendCurrentNote,
} from '../../../utils/context';
import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';
import {
  buildContextFromHistory,
  buildPromptWithHistoryContext,
} from '../../../utils/session';
import { decodeAgyModelId } from '../models';
import { AgyEventNormalizer } from '../normalization/agyEventNormalization';
import { AgyCliResolver } from '../runtime/AgyCliResolver';
import { subscribeAgyJsonlLines } from '../runtime/agyJsonlLines';
import { buildAgyLaunchSpec } from '../runtime/AgyLaunchSpec';
import { parseAgyStreamLine } from '../runtime/agyStream';
import { getAgyProviderSettings } from '../settings';
import { AGY_CONVERSATION_STATE_KEY, getAgyState } from '../types';

const STDERR_BUFFER_LIMIT = 8_000;

type WithoutScope<T> = T extends unknown ? Omit<T, 'scope'> : never;

interface ActiveRun {
  readonly abortController: AbortController;
  readonly events: AsyncEventQueue<ProviderExecutionEvent>;
  readonly executionId: string;
  readonly onRequestAbort: () => void;
  readonly requestSignal: AbortSignal;
  readonly turnId: string;
  sequence: number;
  terminal: boolean;
}

/**
 * One agy conversation, driven through `agy --print --output-format stream-json`.
 *
 * Print mode runs one process per turn and exits when the turn ends, so the
 * session owns no long-lived process. Continuity comes from agy's conversation
 * id, which is captured from the stream and replayed as `--conversation`.
 *
 * Print mode also has no interactive channel: agy auto-denies any permission
 * request rather than asking, so an approval-requiring mode surfaces as failed
 * tool steps. The permission mode is mapped to agy flags in
 * `resolveAgyPermissionFlags` and the consequence is announced once per session.
 */
export class AgyExecutionSession implements ProviderExecutionSession {
  readonly providerId = 'agy' as const;
  readonly sessionInstanceId = randomUUID();

  private activeRun: ActiveRun | null = null;
  private readonly cliResolver = new AgyCliResolver();
  private disposalPromise: Promise<void> | null = null;
  private disposed = false;
  private process: ManagedStdioProcess | null = null;
  private settleActiveTurn: (() => void) | null = null;
  private providerSessionId: string | null;
  private readonly runFlights = new Set<Promise<void>>();
  private revision = 0;
  private readonly sessionListeners = new Set<
    (event: ProviderSessionEvent) => void
  >();
  private sessionSequence = 0;
  private snapshotInvalidation: ProviderSessionInvalidation | null = null;
  private status: ProviderSessionStatus = 'idle';
  private warnedAboutNonInteractivePermissions = false;

  constructor(
    private readonly host: ProviderHost,
    private readonly config: ProviderSessionConfig,
  ) {
    const seed = config.resumeSeed;
    this.providerSessionId = seed?.providerSessionId
      ?? getAgyState(seed?.providerState).conversationId;
  }

  execute(request: ProviderExecutionRequest): ProviderExecutionRun {
    if (this.disposed) {
      throw new Error('agy execution session is disposed');
    }
    if (this.activeRun) {
      throw new Error('agy execution session already has an active run');
    }

    const active = this.createActiveRun(request);
    this.activeRun = active;
    this.setStatus('executing');
    this.emitRequestedState(active);

    if (request.signal.aborted) {
      this.cancel();
    } else {
      const runFlight = this.run(active, request);
      this.runFlights.add(runFlight);
      void runFlight.finally(() => this.runFlights.delete(runFlight));
    }

    return {
      cancel: () => {
        if (this.activeRun === active) this.cancel();
      },
      events: active.events,
      executionId: active.executionId,
      turnId: active.turnId,
    };
  }

  cancel(): void {
    const active = this.activeRun;
    if (!active || active.terminal) return;

    this.setStatus('cancelling');
    this.emitRequestedState(active);
    active.abortController.abort();
    void this.shutdownProcess();
    this.finishRequested(active, { reason: 'Cancelled', type: 'cancelled' });
  }

  getSnapshot(): ProviderSessionSnapshot {
    const base = {
      providerId: this.providerId,
      revision: this.revision,
      ...(this.providerSessionId
        ? {
          providerSessionId: this.providerSessionId,
          providerState: Object.freeze({
            [AGY_CONVERSATION_STATE_KEY]: this.providerSessionId,
          }),
        }
        : {}),
    };

    return Object.freeze(this.status === 'invalidated'
      ? {
        ...base,
        invalidation: Object.freeze(this.snapshotInvalidation ?? {
          reason: 'provider-error' as const,
          recoverable: true,
        }),
        status: 'invalidated' as const,
      }
      : {
        ...base,
        status: this.status,
      });
  }

  getStatus(): ProviderSessionStatus {
    return this.status;
  }

  onEvent(listener: (event: ProviderSessionEvent) => void): () => void {
    if (this.disposed) return () => undefined;
    this.sessionListeners.add(listener);
    return () => this.sessionListeners.delete(listener);
  }

  dispose(): Promise<void> {
    if (this.disposalPromise) return this.disposalPromise;
    this.disposed = true;
    if (this.activeRun) this.cancel();

    this.disposalPromise = (async () => {
      await Promise.allSettled([...this.runFlights]);
      await this.shutdownProcess();
      this.setStatus('disposed');
      this.emitSession({
        snapshot: this.getSnapshot(),
        type: 'session_state_changed',
      });
      this.sessionListeners.clear();
    })();

    return this.disposalPromise;
  }

  private createActiveRun(request: ProviderExecutionRequest): ActiveRun {
    const onRequestAbort = (): void => this.cancel();
    request.signal.addEventListener('abort', onRequestAbort, { once: true });

    return {
      abortController: new AbortController(),
      events: new AsyncEventQueue<ProviderExecutionEvent>(() => this.cancel()),
      executionId: randomUUID(),
      onRequestAbort,
      requestSignal: request.signal,
      sequence: 0,
      terminal: false,
      turnId: randomUUID(),
    };
  }

  private async run(
    active: ActiveRun,
    request: ProviderExecutionRequest,
  ): Promise<void> {
    try {
      const settings = this.host.settings as unknown as Record<string, unknown>;
      const cliPath = this.cliResolver.resolveFromSettings(settings);
      if (!cliPath) {
        this.finishRequested(active, {
          category: 'configuration',
          message: 'The agy CLI was not found. Set its path in Claudian settings.',
          recoverable: true,
          type: 'execution_error',
        });
        return;
      }

      // agy replays its own conversation when --conversation is passed, so the
      // transcript is inlined only for a conversation agy has never seen.
      const prompt = buildAgyPrompt(request, !this.providerSessionId);
      if (!prompt) {
        this.finishRequested(active, {
          category: 'configuration',
          message: 'agy requires prompt text.',
          recoverable: true,
          type: 'execution_error',
        });
        return;
      }

      this.emitRequested(active, { accepted: true, type: 'turn_started' });
      this.emitRequested(active, {
        content: prompt,
        type: 'user_message_started',
      });

      if (request.input.some((block) => block.type === 'image')) {
        this.emitRequested(active, {
          level: 'warning',
          message: 'agy print mode accepts text only; attached images were not sent.',
          type: 'notice',
        });
      }

      const permissionFlags = resolveAgyPermissionFlags(request);
      if (permissionFlags.approvalsUnavailable && !this.warnedAboutNonInteractivePermissions) {
        this.warnedAboutNonInteractivePermissions = true;
        this.emitRequested(active, {
          level: 'warning',
          message: 'agy cannot ask for approval in this mode, so it denies edits and '
            + 'commands instead of prompting. Switch to yolo mode to let them run.',
          type: 'notice',
        });
      }

      const providerSettings = getAgyProviderSettings(settings);
      // Claudian selections are prefixed (`agy:gemini-3.7-flash-medium`) so
      // they cannot collide with other providers. agy knows only the raw id
      // and rejects anything else, so a selection owned by another provider
      // is dropped in favour of agy's own default.
      const model = decodeAgyModelId(
        request.configuration.model ?? providerSettings.selectedModel,
      );
      const launchSpec = buildAgyLaunchSpec({
        cliPath,
        ...(this.providerSessionId ? { conversationId: this.providerSessionId } : {}),
        env: buildAgyEnvironment(settings, cliPath),
        ...(permissionFlags.mode ? { mode: permissionFlags.mode } : {}),
        ...(model ? { model } : {}),
        prompt,
        skipPermissions: permissionFlags.skipPermissions,
        vaultWorkingDirectory: this.config.vaultWorkingDirectory,
        ...(request.configuration.externalWorkspaceRoots
          ? { externalWorkspaceRoots: request.configuration.externalWorkspaceRoots }
          : {}),
      });

      const normalizer = new AgyEventNormalizer({ model });

      await this.streamTurn(active, launchSpec, normalizer);
    } catch (error) {
      // A failure while preparing the turn must still terminate the run
      // stream; an unterminated run blocks the consumer and the session.
      this.finishRequested(active, {
        category: 'unknown',
        message: `agy could not start the turn: ${toMessage(error)}`,
        recoverable: true,
        type: 'execution_error',
      });
    }
  }

  private streamTurn(
    active: ActiveRun,
    launchSpec: ReturnType<typeof buildAgyLaunchSpec>,
    normalizer: AgyEventNormalizer,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const process = new ManagedStdioProcess({
        ...launchSpec,
        stderrBufferLimit: STDERR_BUFFER_LIMIT,
      });
      this.process = process;

      let settled = false;
      const settle = (): void => {
        if (settled) return;
        settled = true;
        this.settleActiveTurn = null;
        resolve();
      };
      this.settleActiveTurn = settle;

      const consumeLine = (line: string): void => {
        const streamEvent = parseAgyStreamLine(line);
        if (!streamEvent) return;

        for (const event of normalizer.next(streamEvent)) {
          if (!this.isActive(active)) return;
          if (event.type === 'turn_completed' || event.type === 'execution_error') {
            this.captureConversationId(normalizer, active);
            this.finishRequested(active, event);
            void this.shutdownProcess();
            settle();
            return;
          }
          this.emitRequested(active, event);
        }
      };

      process.onError((error) => {
        if (this.isActive(active)) {
          this.finishRequested(active, {
            category: 'transport',
            message: `agy could not be started: ${error.message}`,
            recoverable: true,
            type: 'execution_error',
          });
        }
        settle();
      });

      process.onExit(({ code, signal }) => {
        this.captureConversationId(normalizer, active);
        if (this.isActive(active)) {
          this.finishRequested(active, {
            category: 'process-exited',
            message: formatUnexpectedExit(code, signal, process.getStderrSnapshot()),
            recoverable: true,
            type: 'execution_error',
          });
        }
        settle();
      });

      try {
        process.start();
        subscribeAgyJsonlLines(process.stdout, consumeLine);
        process.stdin.end();
      } catch (error) {
        if (this.isActive(active)) {
          this.finishRequested(active, {
            category: 'transport',
            message: `agy could not be started: ${toMessage(error)}`,
            recoverable: true,
            type: 'execution_error',
          });
        }
        settle();
      }
    });
  }

  private captureConversationId(
    normalizer: AgyEventNormalizer,
    active: ActiveRun,
  ): void {
    const conversationId = normalizer.getConversationId();
    if (!conversationId || conversationId === this.providerSessionId) return;

    this.providerSessionId = conversationId;
    this.bumpRevision();
    this.emitRequestedState(active);
  }

  private async shutdownProcess(): Promise<void> {
    const process = this.process;
    if (!process) return;
    // Both are captured before awaiting: by the time shutdown resolves the
    // session may already own a newer turn, and settling that one would end
    // its flight early while leaving this turn's flight pending forever.
    const settle = this.settleActiveTurn;
    this.process = null;
    this.settleActiveTurn = null;
    try {
      await process.shutdown();
    } catch {
      // A turn process that will not stop cannot block session cleanup.
    } finally {
      // A process killed past its final shutdown timeout never notifies its
      // exit listeners, so the turn is settled here rather than waiting on one.
      settle?.();
    }
  }

  private finishRequested(
    active: ActiveRun,
    event: WithoutScope<ProviderExecutionEvent>,
  ): void {
    if (active.terminal) return;
    if (!this.disposed) this.setStatus('idle');
    this.emitRequested(active, event);
    active.terminal = true;
    active.requestSignal.removeEventListener('abort', active.onRequestAbort);
    active.events.close();
    if (this.activeRun === active) this.activeRun = null;
  }

  private emitRequested(
    active: ActiveRun,
    event: WithoutScope<ProviderExecutionEvent>,
  ): void {
    if (active.terminal) return;
    active.events.push({
      ...event,
      scope: this.nextRequestedScope(active),
    });
  }

  private emitRequestedState(active: ActiveRun): void {
    this.emitRequested(active, {
      snapshot: this.getSnapshot(),
      type: 'session_state_changed',
    });
  }

  private emitSession(event: WithoutScope<ProviderSessionEvent>): void {
    const scoped = {
      ...event,
      scope: this.nextSessionScope(),
    } as ProviderSessionEvent;

    for (const listener of this.sessionListeners) {
      try {
        listener(scoped);
      } catch {
        // Session listeners cannot affect process ownership.
      }
    }
  }

  private isActive(active: ActiveRun): boolean {
    return !this.disposed && this.activeRun === active && !active.terminal;
  }

  private setStatus(status: Exclude<ProviderSessionStatus, 'invalidated'>): void {
    this.status = status;
    this.snapshotInvalidation = null;
    this.bumpRevision();
  }

  private nextRequestedScope(active: ActiveRun): ProviderRequestedEventScope {
    return Object.freeze({
      executionId: active.executionId,
      kind: 'requested' as const,
      sequence: ++active.sequence,
      sessionInstanceId: this.sessionInstanceId,
      turnId: active.turnId,
    });
  }

  private nextSessionScope(): ProviderSessionEventScope {
    return Object.freeze({
      kind: 'session' as const,
      sequence: ++this.sessionSequence,
      sessionInstanceId: this.sessionInstanceId,
    });
  }

  private bumpRevision(): void {
    this.revision += 1;
  }
}

interface AgyPermissionFlags {
  readonly approvalsUnavailable: boolean;
  readonly mode: string | null;
  readonly skipPermissions: boolean;
}

/**
 * Maps a Claudian permission mode onto agy print-mode flags.
 *
 * `normal` means "ask before edits", which print mode cannot do. It is mapped
 * to agy's own default rather than silently escalated to accept-edits, so a
 * write is denied and reported instead of being applied unasked.
 */
export function resolveAgyPermissionFlags(
  request: ProviderExecutionRequest,
): AgyPermissionFlags {
  if (request.toolPolicy.kind === 'read-only' || request.toolPolicy.kind === 'passive') {
    return { approvalsUnavailable: true, mode: null, skipPermissions: false };
  }

  switch (request.configuration.permissionMode) {
    case 'yolo':
      return { approvalsUnavailable: false, mode: null, skipPermissions: true };
    case 'plan':
      return { approvalsUnavailable: false, mode: 'plan', skipPermissions: false };
    default:
      return { approvalsUnavailable: true, mode: null, skipPermissions: false };
  }
}

export function buildAgyPrompt(
  request: ProviderExecutionRequest,
  replayHistory: boolean,
): string {
  const text = request.input
    .filter((block): block is { readonly type: 'text'; readonly text: string } =>
      block.type === 'text')
    .map((block) => block.text)
    .join('\n\n')
    .trim();

  if (!text) return '';

  let prompt = text;
  const currentNotePath = request.context?.currentNote?.path;
  if (currentNotePath) {
    prompt = appendCurrentNote(prompt, currentNotePath);
  }

  const externalPaths = request.context?.externalContextPaths;
  if (externalPaths && externalPaths.length > 0) {
    prompt = appendContextFiles(prompt, [...externalPaths]);
  }

  const history = request.conversationHistory;
  if (replayHistory && history && history.length > 0) {
    const messages = [...history] as ChatMessage[];
    prompt = buildPromptWithHistoryContext(
      buildContextFromHistory(messages),
      prompt,
      text,
      messages,
    );
  }

  return prompt;
}

function buildAgyEnvironment(
  settings: Record<string, unknown>,
  cliPath: string,
): NodeJS.ProcessEnv {
  const configured = parseEnvironmentVariables(
    getRuntimeEnvironmentText(settings, 'agy'),
  );

  return {
    ...process.env,
    ...configured,
    PATH: getEnhancedPath(configured.PATH, cliPath),
  };
}

function formatUnexpectedExit(
  code: number | null,
  signal: NodeJS.Signals | null,
  stderr: string,
): string {
  const reason = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
  const detail = stderr.trim();
  return detail
    ? `agy exited (${reason}) before finishing the turn: ${detail}`
    : `agy exited (${reason}) before finishing the turn.`;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class AsyncEventQueue<T> implements AsyncIterable<T>, AsyncIterator<T> {
  private closed = false;
  private readonly values: T[] = [];
  private readonly waiters: Array<(value: IteratorResult<T>) => void> = [];

  constructor(private readonly onEarlyReturn: () => void) {}

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this;
  }

  next(): Promise<IteratorResult<T>> {
    const value = this.values.shift();
    if (value !== undefined) {
      return Promise.resolve({ done: false, value });
    }
    if (this.closed) {
      return Promise.resolve({ done: true, value: undefined });
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  return(): Promise<IteratorResult<T>> {
    if (!this.closed) this.onEarlyReturn();
    return Promise.resolve({ done: true, value: undefined });
  }

  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ done: false, value });
    } else {
      this.values.push(value);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ done: true, value: undefined });
    }
  }
}
