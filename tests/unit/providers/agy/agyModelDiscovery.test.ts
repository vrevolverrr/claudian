import type { ProviderHost } from '@/core/providers/ProviderHost';
import {
  AGY_DEFAULT_CONTEXT_WINDOW,
  decodeAgyModelId,
  encodeAgyModelId,
  parseAgyModelCatalog,
  resolveAgyContextWindow,
} from '@/providers/agy/models';
import { AgyModelDiscoveryService } from '@/providers/agy/runtime/AgyModelDiscoveryService';
import { agyChatUIConfig } from '@/providers/agy/ui/AgyChatUIConfig';

function makeHost(agyConfig: Record<string, unknown>): ProviderHost {
  return {
    settings: { providerConfigs: { agy: agyConfig } },
  } as unknown as ProviderHost;
}

const failingResolver = {
  reset: () => undefined,
  resolveFromSettings: () => {
    throw new Error('discovery must not reach the CLI');
  },
};

describe('AgyModelDiscoveryService.ensureFresh', () => {
  it('does nothing while the provider is disabled', async () => {
    const service = new AgyModelDiscoveryService(
      makeHost({ enabled: false }),
      failingResolver as never,
    );

    await expect(service.ensureFresh()).resolves.toEqual({ changed: false, models: [] });
  });

  it('does nothing when a catalog has already been read', async () => {
    const discoveredModels = [{ id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)' }];
    const service = new AgyModelDiscoveryService(
      makeHost({ discoveredModels, enabled: true }),
      failingResolver as never,
    );

    await expect(service.ensureFresh()).resolves.toEqual({
      changed: false,
      models: discoveredModels,
    });
  });
});

describe('parseAgyModelCatalog', () => {
  it('keeps tab-separated rows and drops progress lines', () => {
    expect(parseAgyModelCatalog([
      'Fetching available models...',
      'gemini-3.1-pro-high\tGemini 3.1 Pro (High)',
      'claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)',
      'gemini-3.1-pro-high\tduplicate ignored',
      '',
    ].join('\n'))).toEqual([
      { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
    ]);
  });
});

describe('agy model selection ids', () => {
  it('round-trips through the prefix agy itself never sees', () => {
    const encoded = encodeAgyModelId('gemini-3.7-flash-medium');

    expect(encoded).toBe('agy:gemini-3.7-flash-medium');
    expect(decodeAgyModelId(encoded)).toBe('gemini-3.7-flash-medium');
  });

  it('disowns a selection belonging to another provider', () => {
    // agy's own catalog contains claude-sonnet-4-6, so a bare id is ambiguous.
    expect(decodeAgyModelId('claude-sonnet-4-6')).toBeNull();
    expect(decodeAgyModelId('pi:anthropic/claude-sonnet-4-6')).toBeNull();
  });
});

describe('agy context windows', () => {
  it('scales the meter per model family, not one flat number', () => {
    expect(resolveAgyContextWindow('gemini-3.1-pro-high')).toBe(1_000_000);
    expect(resolveAgyContextWindow('claude-sonnet-4-6')).toBe(250_000);
    // 131.1k as agy displays it, which is 128Ki rather than a round 128,000.
    expect(resolveAgyContextWindow('gpt-oss-120b-medium')).toBe(131_072);
    expect(resolveAgyContextWindow('some-future-model')).toBe(AGY_DEFAULT_CONTEXT_WINDOW);
  });

  it('lets a configured per-model limit win', () => {
    expect(agyChatUIConfig.getContextWindowSize('agy:claude-sonnet-4-6', {
      'claude-sonnet-4-6': 1_000_000,
    })).toBe(1_000_000);
    expect(agyChatUIConfig.getContextWindowSize('agy:claude-sonnet-4-6', {})).toBe(250_000);
  });
});

describe('agy permission mode', () => {
  it('does not override the shared permission mode write', () => {
    // TabRuntimeUI writes settings.permissionMode itself unless the provider
    // supplies applyPermissionMode; supplying a no-op froze the toggle.
    expect(agyChatUIConfig.applyPermissionMode).toBeUndefined();
  });

  it('projects the shared mode back when switching providers', () => {
    expect(agyChatUIConfig.resolvePermissionMode?.({ permissionMode: 'yolo' })).toBe('yolo');
    expect(agyChatUIConfig.resolvePermissionMode?.({ permissionMode: 'plan' })).toBe('plan');
    expect(agyChatUIConfig.resolvePermissionMode?.({ permissionMode: 'anything' })).toBe('normal');
  });
});
