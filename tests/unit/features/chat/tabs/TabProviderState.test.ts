import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { ProviderChatUIConfig, ProviderIconSvg, ProviderId } from '@/core/providers/types';
import { getBlankTabModelOptions } from '@/features/chat/tabs/TabProviderState';

const FALLBACK_ICON: ProviderIconSvg = { viewBox: '0 0 24 24', path: 'fallback' };
const FAMILY_ICON: ProviderIconSvg = { viewBox: '0 0 24 24', path: 'family' };

function createUiConfig(config: {
  providerIcon?: ProviderIconSvg | null;
  options: Array<{ value: string; label: string; providerIcon?: ProviderIconSvg }>;
}): ProviderChatUIConfig {
  return {
    getModelOptions: () => config.options,
    getProviderIcon: () => config.providerIcon ?? null,
    getCustomModelIds: () => new Set(),
    ownsModel: model => config.options.some(option => option.value === model),
    isAdaptiveReasoningModel: () => false,
    getReasoningOptions: () => [],
    getDefaultReasoningValue: () => 'off',
    getContextWindowSize: () => 200_000,
    isDefaultModel: () => false,
    applyModelDefaults: () => undefined,
    normalizeAvailableModelSelection: model => model,
    normalizeModelVariant: model => model,
  };
}

describe('getBlankTabModelOptions', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps a model option own icon instead of overwriting it with the provider fallback icon', () => {
    jest.spyOn(ProviderRegistry, 'getEnabledProviderIds').mockReturnValue(['agy' as ProviderId]);
    jest.spyOn(ProviderRegistry, 'getChatUIConfig').mockReturnValue(createUiConfig({
      providerIcon: FALLBACK_ICON,
      options: [{ value: 'claude-sonnet', label: 'Claude Sonnet', providerIcon: FAMILY_ICON }],
    }));
    jest.spyOn(ProviderRegistry, 'getProviderDisplayName').mockReturnValue('agy');

    const [option] = getBlankTabModelOptions({});

    expect(option?.providerIcon).toBe(FAMILY_ICON);
  });

  it('falls back to the provider icon when a model option carries none', () => {
    jest.spyOn(ProviderRegistry, 'getEnabledProviderIds').mockReturnValue(['claude' as ProviderId]);
    jest.spyOn(ProviderRegistry, 'getChatUIConfig').mockReturnValue(createUiConfig({
      providerIcon: FALLBACK_ICON,
      options: [{ value: 'opus', label: 'Opus' }],
    }));
    jest.spyOn(ProviderRegistry, 'getProviderDisplayName').mockReturnValue('Claude');

    const [option] = getBlankTabModelOptions({});

    expect(option?.providerIcon).toBe(FALLBACK_ICON);
  });
});
