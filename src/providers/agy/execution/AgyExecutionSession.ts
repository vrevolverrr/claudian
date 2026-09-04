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
import {
  buildSystemPrompt,
  type SystemPromptSettings,
} from '../../../core/prompt/mainAgent';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import type { ChatMessage } from '../../../core/types';
import type { ImageAttachment } from '../../../core/types';
import { appendBrowserContext } from '../../../utils/browser';
import { appendCanvasContext } from '../../../utils/canvas';
import {
  appendContextFiles,
  appendLinkedContent,
} from '../../../utils/context';
import { appendEditorContext } from '../../../utils/editor';
import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';
import {
  buildContextFromHistory,
  buildPromptWithHistoryContext,
} from '../../../utils/session';
import {
  type AgyModel,
  buildAgyModelFamilies,
  composeAgyModelId,
  decodeAgyModelId,
  findAgyModelFamily,
  getEffectiveAgyModels,
  resolveAgyContextWindow,
  resolveAgyDefaultEffort,
  splitAgyModelId,
} from '../models';
import { AgyEventNormalizer } from '../normalization/agyEventNormalization';
import {
  AGY_NO_ARTIFACTS_APPENDIX,
  AGY_NON_INTERACTIVE_APPENDIX,
} from '../prompt/AgySystemPrompt';
import { AgyCliResolver } from '../runtime/AgyCliResolver';
import {
  formatAgyImageReferences,
  materializeAgyImages,
  pruneAgyAttachmentsOnce,
} from '../runtime/AgyImageAttachments';
import { subscribeAgyJsonlLines } from '../runtime/agyJsonlLines';
import { type AgyLaunchSpec, buildAgyLaunchSpec } from '../runtime/AgyLaunchSpec';
import { parseAgyStreamLine } from '../runtime/agyStream';
import { encodeAgyTurnInput } from '../runtime/AgyTurnInput';
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
 * One agy conversation, driven through `agy --input-format stream-json`.
 *
 * The session owns one process that serves every turn: agy runs a turn per
 * NDJSON line on stdin, so its language-server boot and `loadCodeAssist` chain
 * are paid once for the session instead of once per turn. The process is
 * replaced only when it dies or when the turn needs different launch flags,
 * which is when agy's conversation id is replayed as `--conversation`.
 *
 * Print mode has no interactive channel: agy auto-denies any permission
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
  private processConversationId: string | null = null;
  private processKey: string | null = null;
  private settleActiveTurn: (() => void) | null = null;
  private turnConsumer: ((line: string) => void) | null = null;
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
    void pruneAgyAttachmentsOnce(config.vaultWorkingDirectory, Date.now())
      .catch(() => undefined);
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

      const attachments = request.input
        .filter((block): block is { readonly type: 'image'; readonly image: ImageAttachment } =>
          block.type === 'image')
        .map((block) => block.image);
      const images = await materializeAgyImages(
        attachments,
        this.config.vaultWorkingDirectory,
      );

      // agy replays its own conversation when --conversation is passed, so the
      // transcript is inlined only for a conversation agy has never seen.
      const prompt = buildAgyPrompt(
        request,
        !this.providerSessionId,
        images.paths,
        { settings, vaultPath: this.config.vaultWorkingDirectory },
      );
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
      // What the user wrote, not what was sent. System instructions, replayed
      // history and attachment paths are transport detail, and agy already
      // records the full prompt in its own conversation state.
      this.emitRequested(active, {
        content: getAgyInputText(request),
        type: 'user_message_started',
      });

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
      // Claudian selections are prefixed (`agy:gemini-3.7-flash`) so they
      // cannot collide with other providers. agy knows only the raw id and
      // rejects anything else, so a selection owned by another provider is
      // dropped in favour of agy's own default.
      //
      // The selection names a model and the effort is chosen separately, but
      // agy wants them as one id. Splitting first also repairs a selection
      // persisted before the split, which still carries its effort suffix.
      const selected = decodeAgyModelId(
        request.configuration.model ?? providerSettings.selectedModel,
      );
      const model = resolveAgyLaunchModel(
        selected,
        request.configuration.reasoning,
        getEffectiveAgyModels(providerSettings.discoveredModels),
      );
      const launchSpec = buildAgyLaunchSpec({
        cliPath,
        ...(this.providerSessionId ? { conversationId: this.providerSessionId } : {}),
        env: buildAgyEnvironment(settings, cliPath),
        ...(permissionFlags.mode ? { mode: permissionFlags.mode } : {}),
        ...(model ? { model } : {}),
        skipPermissions: permissionFlags.skipPermissions,
        vaultWorkingDirectory: this.config.vaultWorkingDirectory,
        ...(request.configuration.externalWorkspaceRoots
          ? { externalWorkspaceRoots: request.configuration.externalWorkspaceRoots }
          : {}),
      });

      const normalizer = new AgyEventNormalizer({
        contextWindow: resolveContextWindow(
          settings,
          selected ? splitAgyModelId(selected).baseId : null,
        ),
        model,
      });

      await this.streamTurn(active, launchSpec, normalizer, prompt);
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

  /**
   * Runs one turn on the session's process.
   *
   * The turn ends at agy's terminal event and leaves the process running, so
   * the next turn skips the boot entirely. Only a dead process or a change of
   * launch flags costs a restart.
   */
  private streamTurn(
    active: ActiveRun,
    launchSpec: AgyLaunchSpec,
    normalizer: AgyEventNormalizer,
    prompt: string,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const consumeLine = (line: string): void => {
        const streamEvent = parseAgyStreamLine(line);
        if (!streamEvent) return;

        const events = normalizer.next(streamEvent);
        // agy names the conversation in its init event, before the turn
        // produces anything else. Capturing it here rather than at the turn's
        // terminal event is what lets a cancelled or crashed first turn still
        // leave a conversation the next turn can resume; waiting for the end
        // of the turn loses it exactly when the turn does not reach one.
        this.captureConversationId(normalizer, active);

        for (const event of events) {
          if (!this.isActive(active)) return;
          if (event.type === 'turn_completed' || event.type === 'execution_error') {
            this.finishRequested(active, event);
            settle();
            return;
          }
          this.emitRequested(active, event);
        }
      };
      const settle = (): void => {
        if (settled) return;
        settled = true;
        // Only hooks this turn still owns are cleared. A cancelled turn settles
        // when its process finally exits, and by then the session may already be
        // streaming a newer turn whose consumer must survive.
        if (this.settleActiveTurn === settle) this.settleActiveTurn = null;
        if (this.turnConsumer === consumeLine) this.turnConsumer = null;
        resolve();
      };
      this.settleActiveTurn = settle;

      if (!this.isActive(active)) {
        settle();
        return;
      }

      this.turnConsumer = consumeLine;

      // The consumer is wired before the process starts: agy emits its init
      // event as soon as it is spawned, ahead of this turn reaching stdin.
      void this.ensureProcess(active, launchSpec)
        .then((process) => {
          if (!process || !this.isActive(active)) {
            settle();
            return;
          }
          // The callback absorbs a broken pipe: a reused process can die
          // between the reuse check and this write, and an unhandled stdin
          // error event would take the plugin down rather than the turn.
          process.stdin.write(encodeAgyTurnInput(prompt), (error) => {
            if (!error || !this.isActive(active)) return;
            this.finishRequested(active, {
              category: 'transport',
              message: `agy could not be sent the turn: ${toMessage(error)}`,
              recoverable: true,
              type: 'execution_error',
            });
            settle();
          });
        })
        .catch((error: unknown) => {
          if (this.isActive(active)) {
            this.finishRequested(active, {
              category: 'transport',
              message: `agy could not be sent the turn: ${toMessage(error)}`,
              recoverable: true,
              type: 'execution_error',
            });
          }
          settle();
        });
    });
  }

  /**
   * Returns the process this turn should run on, starting one when the session
   * has none, when the previous one exited, or when the launch flags changed.
   *
   * The reuse key ignores `--conversation`: a live process already holds the
   * conversation it created, and re-passing the id would restart it on every
   * turn after the first. The conversation the process is bound to is compared
   * separately, so a session pointed at a different conversation still respawns.
   */
  private async ensureProcess(
    active: ActiveRun,
    launchSpec: AgyLaunchSpec,
  ): Promise<ManagedStdioProcess | null> {
    const key = describeLaunchIdentity(launchSpec);
    if (
      this.process
      && this.processKey === key
      && this.processConversationId === this.providerSessionId
    ) {
      return this.process;
    }

    await this.stopProcess();
    // Cancellation can land while the outgoing process is still stopping.
    // Starting agy for a turn nobody is waiting on would run the prompt anyway.
    if (!this.isActive(active)) return null;

    const process = new ManagedStdioProcess({
      ...launchSpec,
      stderrBufferLimit: STDERR_BUFFER_LIMIT,
    });
    this.process = process;
    this.processKey = key;
    this.processConversationId = this.providerSessionId;

    // Every listener below ignores a process the session has already let go of.
    // A replaced process exits while the turn that replaced it is running, and
    // `stopProcess` drops it before awaiting that exit, so without the guard
    // the outgoing process fails and feeds the incoming turn.
    process.onError((error) => {
      if (this.process !== process) return;
      this.failActiveTurn({
        category: 'transport',
        message: `agy could not be started: ${toMessage(error)}`,
        recoverable: true,
        type: 'execution_error',
      });
      this.forgetProcess(process);
    });

    process.onExit(({ code, signal }) => {
      if (this.process !== process) return;
      this.failActiveTurn({
        category: 'process-exited',
        message: formatUnexpectedExit(code, signal, process.getStderrSnapshot()),
        recoverable: true,
        type: 'execution_error',
      });
      this.forgetProcess(process);
    });

    try {
      process.start();
      // A failed write reports through its own callback, but Node still emits
      // 'error' on the stream, and an unhandled one on a broken pipe takes the
      // whole plugin down rather than the turn.
      process.stdin.on('error', () => undefined);
      subscribeAgyJsonlLines(process.stdout, (line) => {
        if (this.process !== process) return;
        this.turnConsumer?.(line);
      });
    } catch (error) {
      this.forgetProcess(process);
      if (this.isActive(active)) {
        this.finishRequested(active, {
          category: 'transport',
          message: `agy could not be started: ${toMessage(error)}`,
          recoverable: true,
          type: 'execution_error',
        });
      }
      return null;
    }

    return process;
  }

  /**
   * Ends whatever turn the process was serving. Process failures arrive on
   * listeners attached once at spawn, so the run they belong to is whichever
   * one is active now rather than the one that started the process.
   *
   * A pending settle is what binds a turn to the process. Without one the
   * process died between turns, and the next turn is still being prepared: it
   * must respawn on a forgotten process rather than inherit its exit.
   */
  private failActiveTurn(event: WithoutScope<ProviderExecutionEvent>): void {
    const settle = this.settleActiveTurn;
    if (!settle) return;

    const active = this.activeRun;
    if (active && this.isActive(active)) this.finishRequested(active, event);
    settle();
  }

  private forgetProcess(process: ManagedStdioProcess): void {
    if (this.process !== process) return;
    this.process = null;
    this.processConversationId = null;
    this.processKey = null;
    this.turnConsumer = null;
    this.settleActiveTurn = null;
  }

  private captureConversationId(
    normalizer: AgyEventNormalizer,
    active: ActiveRun,
  ): void {
    const conversationId = normalizer.getConversationId();
    if (!conversationId || conversationId === this.providerSessionId) return;

    this.providerSessionId = conversationId;
    this.processConversationId = conversationId;
    this.bumpRevision();
    this.emitRequestedState(active);
  }

  /**
   * Stops the session's process and ends the turn it was serving. Only
   * cancellation and disposal take a turn down with the process; replacing a
   * process between turns must not, so that path uses `stopProcess` instead.
   */
  private async shutdownProcess(): Promise<void> {
    // The settle runs even with no process to stop. A turn cancelled before
    // its process exists has nothing that will ever exit on its behalf, and an
    // unsettled turn leaves its flight pending, which hangs disposal forever.
    //
    // Captured before awaiting: by the time shutdown resolves the session may
    // already own a newer turn, and settling that one would end its flight
    // early while leaving this turn's flight pending forever.
    const settle = this.settleActiveTurn;
    this.settleActiveTurn = null;
    this.turnConsumer = null;
    try {
      await this.stopProcess();
    } finally {
      // A process killed past its final shutdown timeout never notifies its
      // exit listeners, so the turn is settled here rather than waiting on one.
      settle?.();
    }
  }

  /** Stops the process without touching whatever turn is being set up. */
  private async stopProcess(): Promise<void> {
    const process = this.process;
    if (!process) return;
    this.process = null;
    this.processConversationId = null;
    this.processKey = null;
    try {
      await process.shutdown();
    } catch {
      // A process that will not stop cannot block session cleanup.
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

/**
 * Builds the id agy expects from a Claudian selection and the chosen effort.
 *
 * The selection names a model and effort is chosen separately, but agy wants
 * one id. Only an effort the catalog actually publishes for that model is
 * appended: the shared effort setting outlives a switch to a model that has no
 * variants, and agy rejects an id it does not serve. Splitting first also
 * repairs a selection persisted before model and effort were separated.
 */
export function resolveAgyLaunchModel(
  selectedRawId: string | null,
  reasoning: string | undefined,
  catalog: readonly AgyModel[],
): string | null {
  if (!selectedRawId) return null;

  const { baseId, effort } = splitAgyModelId(selectedRawId);
  const family = findAgyModelFamily(buildAgyModelFamilies(catalog), baseId);
  if (!family || family.variants.length === 0) return baseId;

  const offered = new Set<string>(family.variants.map((variant) => variant.effort));
  const requested = [reasoning, effort].find(
    (candidate) => candidate && offered.has(candidate),
  );

  return composeAgyModelId(
    baseId,
    requested ?? resolveAgyDefaultEffort(family),
  );
}

export function getAgyInputText(request: ProviderExecutionRequest): string {
  return request.input
    .filter((block): block is { readonly type: 'text'; readonly text: string } =>
      block.type === 'text')
    .map((block) => block.text)
    .join('\n\n')
    .trim();
}

export interface AgyPromptEnvironment {
  readonly settings: Record<string, unknown>;
  readonly vaultPath: string;
}

/**
 * agy has no system-prompt flag, so instructions ride in the prompt.
 *
 * `--conversation` replays everything agy was already told, so the vault
 * system prompt is sent once, on the turn that creates the conversation. An
 * explicit prompt — inline edit, title generation — replaces it outright and
 * is sent every time, because those run as their own one-shot conversations.
 *
 * Sending it once also means a conversation never sees a section added later.
 * A new appendix reaches only conversations created after the change; existing
 * ones need a new chat.
 */
function resolveAgySystemPrompt(
  request: ProviderExecutionRequest,
  isFirstTurn: boolean,
  environment?: AgyPromptEnvironment,
): string {
  const { systemInstructions } = request.configuration;
  if (systemInstructions.kind === 'explicit') {
    return systemInstructions.instructions.trim();
  }
  if (!isFirstTurn || !environment) return '';

  return buildSystemPrompt({
    customPrompt: readSetting(environment.settings.systemPrompt),
    mediaFolder: readSetting(environment.settings.mediaFolder),
    userName: readSetting(environment.settings.userName),
    vaultPath: environment.vaultPath,
  } satisfies SystemPromptSettings, {
    // agy's own two sections are appended to the caller's rather than
    // substituted, so a caller-supplied section still reaches agy.
    dynamicSections: [
      ...(systemInstructions.dynamicSections ?? []),
      AGY_NON_INTERACTIVE_APPENDIX,
      AGY_NO_ARTIFACTS_APPENDIX,
    ],
  });
}

function readSetting(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function buildAgyPrompt(
  request: ProviderExecutionRequest,
  replayHistory: boolean,
  imagePaths: readonly string[] = [],
  environment?: AgyPromptEnvironment,
): string {
  const text = getAgyInputText(request);

  if (!text && imagePaths.length === 0) return '';

  const systemPrompt = resolveAgySystemPrompt(request, replayHistory, environment);
  let prompt = systemPrompt ? `${systemPrompt}\n\n${text}` : text;
  const context = request.context;
  const linkedContentPath = context?.linkedContent?.path;
  if (linkedContentPath) {
    prompt = appendLinkedContent(prompt, linkedContentPath);
  }
  // The chat input builds all four together, so dropping the selections keeps
  // the note path while silently losing what the user actually pointed at.
  if (context?.editorSelection) {
    prompt = appendEditorContext(prompt, context.editorSelection);
  }
  if (context?.browserSelection) {
    prompt = appendBrowserContext(prompt, context.browserSelection);
  }
  if (context?.canvasSelection) {
    prompt = appendCanvasContext(prompt, context.canvasSelection);
  }

  const imageReferences = formatAgyImageReferences(imagePaths);
  if (imageReferences) {
    prompt = `${prompt}\n\n${imageReferences}`;
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

/**
 * The meter shows this window until the model changes, so it is resolved the
 * same way the model selector resolves it: a per-model limit from settings
 * first, then the family default.
 */
function resolveContextWindow(
  settings: Record<string, unknown>,
  rawModelId: string | null,
): number {
  if (!rawModelId) return resolveAgyContextWindow('');

  const limits = settings.customContextLimits;
  const configured = isRecord(limits) ? limits[rawModelId] : undefined;
  return typeof configured === 'number' && configured > 0
    ? configured
    : resolveAgyContextWindow(rawModelId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

/**
 * Identifies a process by everything except the conversation it resumes, so a
 * turn that only gained agy's conversation id reuses the running process.
 */
function describeLaunchIdentity(launchSpec: AgyLaunchSpec): string {
  const args: string[] = [];
  for (let index = 0; index < launchSpec.args.length; index += 1) {
    if (launchSpec.args[index] === '--conversation') {
      index += 1;
      continue;
    }
    args.push(launchSpec.args[index]);
  }

  return JSON.stringify({
    args,
    command: launchSpec.command,
    cwd: launchSpec.cwd,
    env: launchSpec.env,
  });
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
