import type { ProviderHost } from '@/core/providers/ProviderHost';
import { decodeAgyModelId, encodeAgyModelId, parseAgyModelCatalog } from '@/providers/agy/models';
import { AgyModelDiscoveryService } from '@/providers/agy/runtime/AgyModelDiscoveryService';

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
