import type * as streamModule from 'node:stream';
import type { PassThrough } from 'node:stream';

import type {
  ProviderExecutionEvent,
  ProviderExecutionRequest,
  ProviderSessionConfig,
} from '@/core/execution';
import type { ProviderHost } from '@/core/providers/ProviderHost';
import { AgyExecutionSession } from '@/providers/agy/execution/AgyExecutionSession';

// The session resolves the agy binary from disk before it writes a turn, so
// without this the suite only passes on a machine that happens to have agy
// installed and fails everywhere else, CI included.
jest.mock('@/providers/agy/runtime/AgyCliResolver', () => ({
  AgyCliResolver: class {
    resolveFromSettings(): string {
      return '/usr/local/bin/agy';
    }

    reset(): void {}
  },
}));

jest.mock('@/core/process/ManagedStdioProcess', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PassThrough: Pass } = require('node:stream') as typeof streamModule;

  class FakeManagedStdioProcess {
    readonly stdin = new Pass();
    readonly stdout = new Pass();
    readonly written: string[] = [];
    exitListeners: Array<(state: unknown) => void> = [];
    shutdownCalls = 0;
    started = false;

    readonly args: string[];

    constructor(options: { args: string[] }) {
      // Only the args are kept: a failing assertion prints this object, and
      // the spawn environment carries the developer's own secrets.
      this.args = options.args;
      instances.push(this as unknown as FakeProcess);
      this.stdin.on('data', (chunk: Buffer) => this.written.push(String(chunk)));
    }

    start(): void {
      this.started = true;
      onStart?.(this as unknown as FakeProcess);
    }

    onError(): void {
      // The reuse tests never fail the spawn.
    }

    onExit(listener: (state: unknown) => void): void {
      this.exitListeners.push(listener);
    }

    getStderrSnapshot(): string {
      return '';
    }

    async shutdown(): Promise<void> {
      this.shutdownCalls += 1;
      // Faithful to ManagedStdioProcess: shutdown resolves off its own exit
      // listener, and a process that ignores SIGTERM keeps it pending for
      // seconds, which a test holds open through `holdShutdown`.
      if (holdShutdown) await holdShutdown;
      for (const listener of this.exitListeners) {
        listener({ closed: true, code: null, signal: 'SIGTERM' });
      }
    }
  }

  return { ManagedStdioProcess: FakeManagedStdioProcess };
});

interface FakeProcess {
  readonly args: string[];
  readonly stdout: PassThrough;
  readonly written: string[];
  exitListeners: Array<(state: unknown) => void>;
  shutdownCalls: number;
  started: boolean;
}

const instances: FakeProcess[] = [];

/** Lets a test answer at spawn time, before the turn reaches stdin. */
let onStart: ((process: FakeProcess) => void) | null = null;

/** Holds every `shutdown()` open, the way a process ignoring SIGTERM does. */
let holdShutdown: Promise<void> | null = null;

const CONVERSATION_ID = '70cfe915-2dba-4110-a19c-310b0abb91b3';

function initLine(conversationId = CONVERSATION_ID): string {
  return `${JSON.stringify({
    conversation_id: conversationId,
    event: 'init',
    init: { cwd: '/vault', tools: [] },
  })}\n`;
}

function resultLine(response: string, conversationId = CONVERSATION_ID): string {
  return `${JSON.stringify({
    event: 'result',
    result: {
      conversation_id: conversationId,
      duration_seconds: 1,
      num_turns: 1,
      response,
      status: 'SUCCESS',
    },
  })}\n`;
}

const VAULT_PROMPT_MARKER = 'MARKER-VAULT-SYSTEM-PROMPT';

function makeSession(resumeSeed?: { providerSessionId: string }): AgyExecutionSession {
  const settings = {
    providers: { agy: { cliPath: process.execPath, enabled: true } },
    systemPrompt: VAULT_PROMPT_MARKER,
  } as unknown as ProviderHost['settings'];

  const host = { settings } as unknown as ProviderHost;
  const config = {
    vaultWorkingDirectory: '/vault',
    ...(resumeSeed ? { resumeSeed } : {}),
  } as unknown as ProviderSessionConfig;

  return new AgyExecutionSession(host, config);
}

function makeRequest(text: string): ProviderExecutionRequest {
  return {
    configuration: {
      permissionMode: 'yolo',
      systemInstructions: { kind: 'explicit', instructions: 'be terse' },
    },
    input: [{ text, type: 'text' }],
    signal: new AbortController().signal,
    toolPolicy: { kind: 'provider-default' },
  };
}

function turnsSent(): number {
  return instances.reduce((total, instance) => total + instance.written.length, 0);
}

/**
 * Runs one turn to completion, answering on the stream only once the turn has
 * been written to stdin. agy speaks only after it is spoken to, and replying
 * earlier would race the turn's own stream subscription.
 */
async function runTurn(
  session: AgyExecutionSession,
  text: string,
  respond: (process: FakeProcess) => void,
  overrides: Partial<ProviderExecutionRequest> = {},
): Promise<ProviderExecutionEvent[]> {
  const sentBefore = turnsSent();
  const run = session.execute({ ...makeRequest(text), ...overrides });
  const events: ProviderExecutionEvent[] = [];

  const collected = (async () => {
    for await (const event of run.events) events.push(event);
  })();

  await waitFor(() => turnsSent() > sentBefore);
  respond(instances[instances.length - 1]);
  await collected;

  return events;
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('condition was never met');
}

beforeEach(() => {
  instances.length = 0;
  holdShutdown = null;
  onStart = null;
});

async function flushMicrotasks(): Promise<void> {
  for (let tick = 0; tick < 5; tick += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('AgyExecutionSession process reuse', () => {
  it('serves a second turn from the process the first turn started', async () => {
    const session = makeSession();

    await runTurn(session, 'first', (proc) => {
      proc.stdout.write(initLine());
      proc.stdout.write(resultLine('one'));
    });
    await runTurn(session, 'second', (proc) => {
      proc.stdout.write(resultLine('two'));
    });

    expect(instances).toHaveLength(1);
    expect(instances[0].written).toHaveLength(2);
    await session.dispose();
  });

  it('starts a fresh process when the turn needs different launch flags', async () => {
    const session = makeSession();

    await runTurn(session, 'first', (proc) => {
      proc.stdout.write(initLine());
      proc.stdout.write(resultLine('one'));
    });

    const sentBefore = turnsSent();
    const run = session.execute({
      ...makeRequest('second'),
      configuration: {
        permissionMode: 'plan',
        systemInstructions: { instructions: 'be terse', kind: 'explicit' },
      },
    });
    const collected = (async () => {
      for await (const event of run.events) void event;
    })();
    await waitFor(() => turnsSent() > sentBefore);
    instances[instances.length - 1].stdout.write(resultLine('two'));
    await collected;

    expect(instances).toHaveLength(2);
    expect(instances[0].shutdownCalls).toBe(1);
    expect(instances[1].args).toContain('--conversation');
    expect(instances[1].args[instances[1].args.indexOf('--conversation') + 1])
      .toBe(CONVERSATION_ID);

    await session.dispose();
  });

  it('starts a fresh process when the previous one exited between turns', async () => {
    const session = makeSession();

    await runTurn(session, 'first', (proc) => {
      proc.stdout.write(initLine());
      proc.stdout.write(resultLine('one'));
    });
    for (const listener of instances[0].exitListeners) {
      listener({ closed: true, code: 0, signal: null });
    }

    await runTurn(session, 'second', (proc) => {
      proc.stdout.write(resultLine('two'));
    });

    expect(instances).toHaveLength(2);
    expect(instances[1].args).toContain('--conversation');

    await session.dispose();
  });

  it('sends each turn as one NDJSON user event, the only input event agy reads', async () => {
    const session = makeSession();

    await runTurn(session, 'summarize my notes', (proc) => {
      proc.stdout.write(initLine());
      proc.stdout.write(resultLine('done'));
    });

    const [line] = instances[0].written;
    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line)).toEqual({
      event: 'user',
      message: { content: expect.stringContaining('summarize my notes'), role: 'user' },
    });

    await session.dispose();
  });

  it('captures the conversation id from an init event that beats the first turn', async () => {
    const session = makeSession();
    onStart = (proc) => proc.stdout.write(initLine());

    await runTurn(session, 'first', (proc) => {
      proc.stdout.write(`${JSON.stringify({
        event: 'result',
        result: { duration_seconds: 1, num_turns: 1, response: 'one', status: 'SUCCESS' },
      })}\n`);
    });

    expect(session.getSnapshot().providerSessionId).toBe(CONVERSATION_ID);

    await session.dispose();
  });

  it('does not fail the new turn with the exit of the process it replaced', async () => {
    const session = makeSession();

    await runTurn(session, 'first', (proc) => {
      proc.stdout.write(initLine());
      proc.stdout.write(resultLine('one'));
    });

    const sentBefore = turnsSent();
    const run = session.execute({
      ...makeRequest('second'),
      configuration: {
        permissionMode: 'plan',
        systemInstructions: { instructions: 'be terse', kind: 'explicit' },
      },
    });
    const events: ProviderExecutionEvent[] = [];
    const collected = (async () => {
      for await (const event of run.events) events.push(event);
    })();
    await waitFor(() => turnsSent() > sentBefore);
    instances[instances.length - 1].stdout.write(resultLine('two'));
    await collected;

    expect(events.filter((event) => event.type === 'execution_error')).toEqual([]);
    expect(events.some((event) => event.type === 'turn_completed')).toBe(true);

    await session.dispose();
  });

  it('keeps the next turn streaming while a cancelled turn is still shutting down', async () => {
    const session = makeSession();
    await runTurn(session, 'first', (proc) => {
      proc.stdout.write(initLine());
      proc.stdout.write(resultLine('one'));
    });

    // The cancelled turn's process ignores SIGTERM, so its shutdown stays
    // pending — and its turn stays unsettled — well into the next turn.
    let releaseShutdown = (): void => undefined;
    holdShutdown = new Promise<void>((resolve) => {
      releaseShutdown = resolve;
    });

    const sentBeforeCancelled = turnsSent();
    const cancelled = session.execute(makeRequest('second'));
    const cancelledDone = (async () => {
      for await (const event of cancelled.events) void event;
    })();
    await waitFor(() => turnsSent() > sentBeforeCancelled);
    cancelled.cancel();
    await cancelledDone;

    const sentBefore = turnsSent();
    const run = session.execute(makeRequest('third'));
    const events: ProviderExecutionEvent[] = [];
    const collected = (async () => {
      for await (const event of run.events) events.push(event);
    })();
    await waitFor(() => turnsSent() > sentBefore);

    releaseShutdown();
    await flushMicrotasks();
    instances[instances.length - 1].stdout.write(resultLine('three'));

    const finished = await Promise.race([
      collected.then(() => 'finished'),
      new Promise((resolve) => setTimeout(() => resolve('hung'), 500)),
    ]);

    expect(finished).toBe('finished');
    expect(events.some((event) => event.type === 'turn_completed')).toBe(true);

    holdShutdown = null;
    await session.dispose();
  });

  it('settles a turn cancelled before its process exists, and starts none', async () => {
    const session = makeSession();
    const run = session.execute(makeRequest('first'));
    const collected = (async () => {
      for await (const event of run.events) void event;
    })();

    // Cancelled while the turn is still being prepared: no process exists yet,
    // so nothing will ever exit to end the run on the session's behalf.
    run.cancel();
    await collected;

    const disposed = await Promise.race([
      session.dispose().then(() => 'disposed'),
      new Promise((resolve) => setTimeout(() => resolve('hung'), 500)),
    ]);

    expect(disposed).toBe('disposed');
    expect(instances).toHaveLength(0);
  });

  it('keeps the conversation agy announced when its first turn is cancelled', async () => {
    const session = makeSession();
    const run = session.execute(makeRequest('first'));
    const collected = (async () => {
      for await (const event of run.events) void event;
    })();

    await waitFor(() => turnsSent() > 0);
    // agy names the conversation before the turn produces anything else, so a
    // cancelled first turn still leaves a conversation worth resuming.
    instances[0].stdout.write(initLine());
    await waitFor(() => session.getSnapshot().providerSessionId === CONVERSATION_ID);
    run.cancel();
    await collected;

    await runTurn(session, 'second', (proc) => {
      proc.stdout.write(resultLine('two'));
    });

    expect(instances[1].args).toContain('--conversation');
    expect(instances[1].args[instances[1].args.indexOf('--conversation') + 1])
      .toBe(CONVERSATION_ID);

    await session.dispose();
  });

  it('resumes a seeded conversation without replaying the prompt agy already has', async () => {
    const session = makeSession({ providerSessionId: CONVERSATION_ID });

    await runTurn(session, 'resumed question', (proc) => {
      proc.stdout.write(resultLine('answer'));
    }, {
      configuration: { permissionMode: 'yolo', systemInstructions: { kind: 'provider-default' } },
      conversationHistory: [
        { content: 'earlier question', id: 'm1', role: 'user', timestamp: 1 },
        { content: 'earlier answer', id: 'm2', role: 'assistant', timestamp: 2 },
      ],
    });

    expect(instances[0].args[instances[0].args.indexOf('--conversation') + 1])
      .toBe(CONVERSATION_ID);
    // agy replays what it was already told, so neither the vault system prompt
    // nor the transcript is re-sent to a conversation it already holds.
    const sent = JSON.parse(instances[0].written[0]) as { message: { content: string } };
    expect(sent.message.content).toBe('resumed question');

    await session.dispose();
  });
});
