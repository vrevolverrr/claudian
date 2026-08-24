import type {
  ProviderExecutionRequest,
  ProviderToolPolicy,
} from '@/core/execution';
import type { PermissionMode } from '@/core/types/settings';
import {
  buildAgyPrompt,
  getAgyInputText,
  resolveAgyPermissionFlags,
} from '@/providers/agy/execution/AgyExecutionSession';
import { buildAgyLaunchSpec } from '@/providers/agy/runtime/AgyLaunchSpec';

function makeRequest(
  permissionMode: PermissionMode,
  toolPolicy: ProviderToolPolicy = { kind: 'provider-default' },
  overrides: Partial<ProviderExecutionRequest> = {},
): ProviderExecutionRequest {
  return {
    configuration: {
      permissionMode,
      systemInstructions: { kind: 'provider-default' },
    },
    input: [{ text: 'summarize my notes', type: 'text' }],
    signal: new AbortController().signal,
    toolPolicy,
    ...overrides,
  };
}

describe('resolveAgyPermissionFlags', () => {
  it('passes --dangerously-skip-permissions only in yolo mode', () => {
    expect(resolveAgyPermissionFlags(makeRequest('yolo')).skipPermissions).toBe(true);
    expect(resolveAgyPermissionFlags(makeRequest('normal')).skipPermissions).toBe(false);
    expect(resolveAgyPermissionFlags(makeRequest('plan')).skipPermissions).toBe(false);
  });

  it('never escalates normal mode to accept-edits, because agy cannot ask', () => {
    const flags = resolveAgyPermissionFlags(makeRequest('normal'));

    expect(flags.mode).toBeNull();
    expect(flags.skipPermissions).toBe(false);
    expect(flags.approvalsUnavailable).toBe(true);
  });

  it('keeps a read-only tool policy read-only even when the mode says yolo', () => {
    const flags = resolveAgyPermissionFlags(
      makeRequest('yolo', { kind: 'read-only' }),
    );

    expect(flags.skipPermissions).toBe(false);
  });

  it('selects plan mode without skipping permissions', () => {
    expect(resolveAgyPermissionFlags(makeRequest('plan'))).toEqual({
      approvalsUnavailable: false,
      mode: 'plan',
      skipPermissions: false,
    });
  });
});

describe('buildAgyLaunchSpec', () => {
  const base = {
    cliPath: '/usr/local/bin/agy',
    env: {},
    prompt: 'hello',
    vaultWorkingDirectory: '/vault',
  };

  it('always requests the machine-readable stream', () => {
    const spec = buildAgyLaunchSpec({ ...base, skipPermissions: false });

    expect(spec.args.slice(0, 4)).toEqual(['--print', 'hello', '--output-format', 'stream-json']);
    expect(spec.cwd).toBe('/vault');
    expect(spec.command).toBe('/usr/local/bin/agy');
  });

  it('omits the permission override unless it was asked for', () => {
    expect(buildAgyLaunchSpec({ ...base, skipPermissions: false }).args)
      .not.toContain('--dangerously-skip-permissions');
    expect(buildAgyLaunchSpec({ ...base, skipPermissions: true }).args)
      .toContain('--dangerously-skip-permissions');
  });

  it('resumes agy\'s own conversation when one is known', () => {
    const spec = buildAgyLaunchSpec({
      ...base,
      conversationId: 'abc-123',
      skipPermissions: false,
    });

    expect(spec.args).toContain('--conversation');
    expect(spec.args[spec.args.indexOf('--conversation') + 1]).toBe('abc-123');
  });

  it('passes the raw agy model id and never an effort flag', () => {
    const spec = buildAgyLaunchSpec({
      ...base,
      model: 'gemini-3.7-flash-medium',
      skipPermissions: false,
    });

    expect(spec.args[spec.args.indexOf('--model') + 1]).toBe('gemini-3.7-flash-medium');
    expect(spec.args).not.toContain('--effort');
  });

  it('deduplicates workspace roots against the vault directory', () => {
    const spec = buildAgyLaunchSpec({
      ...base,
      externalWorkspaceRoots: ['/vault', '/vault/../vault', '/other'],
      skipPermissions: false,
    });

    expect(spec.args.filter((arg) => arg === '--add-dir')).toHaveLength(2);
    expect(spec.args).toContain('/other');
  });
});

describe('getAgyInputText', () => {
  it('is what the user wrote, without the transport scaffolding', () => {
    const request = makeRequest('yolo', { kind: 'provider-default' }, {
      configuration: {
        permissionMode: 'yolo',
        systemInstructions: { instructions: 'Answer tersely.', kind: 'explicit' },
      },
      context: { currentNote: { path: 'Daily/2026-08-18.md' } },
    });

    expect(getAgyInputText(request)).toBe('summarize my notes');
    expect(buildAgyPrompt(request, false)).not.toBe(getAgyInputText(request));
  });
});

describe('buildAgyPrompt', () => {
  it('returns empty for an image-only prompt so the turn fails loudly', () => {
    expect(buildAgyPrompt(makeRequest('yolo', { kind: 'provider-default' }, {
      input: [],
    }), true)).toBe('');
  });

  it('replays the transcript only for a conversation agy has never seen', () => {
    const withHistory = makeRequest('yolo', { kind: 'provider-default' }, {
      conversationHistory: [
        { content: 'what did I write yesterday', id: '1', role: 'user', timestamp: 0 },
        { content: 'a note about otters', id: '2', role: 'assistant', timestamp: 1 },
      ],
    });

    expect(buildAgyPrompt(withHistory, true)).toContain('otters');
    expect(buildAgyPrompt(withHistory, false)).not.toContain('otters');
  });

  it('sends the vault system prompt once, on the turn that creates the conversation', () => {
    const request = makeRequest('yolo');
    const environment = { settings: { userName: 'Bryan' }, vaultPath: '/vault' };

    const first = buildAgyPrompt(request, true, [], environment);
    expect(first).toContain('You are **Claudian**');
    expect(first).toContain('Bryan');
    expect(first).toContain('/vault');

    // --conversation replays it; repeating it every turn would only grow.
    expect(buildAgyPrompt(request, false, [], environment)).toBe('summarize my notes');
  });

  it('lets an explicit prompt replace the vault prompt entirely', () => {
    const request = makeRequest('yolo', { kind: 'provider-default' }, {
      configuration: {
        permissionMode: 'yolo',
        systemInstructions: { instructions: 'Return only the rewritten text.', kind: 'explicit' },
      },
    });
    const prompt = buildAgyPrompt(request, true, [], {
      settings: {},
      vaultPath: '/vault',
    });

    expect(prompt).toBe('Return only the rewritten text.\n\nsummarize my notes');
    expect(prompt).not.toContain('You are **Claudian**');
  });

  it('carries explicit system instructions, which agy has no flag for', () => {
    const request = makeRequest('yolo', { kind: 'provider-default' }, {
      configuration: {
        permissionMode: 'yolo',
        systemInstructions: {
          instructions: 'Reply with the replacement text only.',
          kind: 'explicit',
        },
      },
    });

    expect(buildAgyPrompt(request, false))
      .toBe('Reply with the replacement text only.\n\nsummarize my notes');
  });

  it('appends the current note path', () => {
    const prompt = buildAgyPrompt(makeRequest('yolo', { kind: 'provider-default' }, {
      context: { currentNote: { path: 'Daily/2026-08-18.md' } },
    }), true);

    expect(prompt).toContain('summarize my notes');
    expect(prompt).toContain('Daily/2026-08-18.md');
  });

  it('tells agy that a vault write is never one of its artifacts', () => {
    // ArtifactMetadata on a vault path fails the whole turn with
    // "is not a valid artifact path; artifacts must be in .../brain/<id>/".
    const prompt = buildAgyPrompt(makeRequest('yolo'), true, [], {
      settings: {},
      vaultPath: '/vault',
    });

    expect(prompt).toContain('ArtifactMetadata');
  });

  it('carries the editor selection, which the chat input sends beside the note path', () => {
    const prompt = buildAgyPrompt(makeRequest('yolo', { kind: 'provider-default' }, {
      context: {
        currentNote: { path: 'Daily/2026-08-18.md' },
        editorSelection: {
          mode: 'selection',
          notePath: 'Daily/2026-08-18.md',
          selectedText: 'the otter paragraph',
        },
      },
    }), true);

    expect(prompt).toContain('the otter paragraph');
  });
});
