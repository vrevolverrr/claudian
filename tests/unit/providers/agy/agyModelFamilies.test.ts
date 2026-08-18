import { agySettingsReconciler } from '@/providers/agy/env/AgySettingsReconciler';
import { resolveAgyLaunchModel } from '@/providers/agy/execution/AgyExecutionSession';
import {
  buildAgyModelFamilies,
  composeAgyModelId,
  findAgyModelFamily,
  resolveAgyDefaultEffort,
  splitAgyModelId,
} from '@/providers/agy/models';
import { agyChatUIConfig } from '@/providers/agy/ui/AgyChatUIConfig';

/** A trimmed copy of what `agy models` prints. */
const CATALOG = [
  { id: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash (High)' },
  { id: 'gemini-3.7-flash-medium', label: 'Gemini 3.7 Flash (Medium)' },
  { id: 'gemini-3.7-flash-low', label: 'Gemini 3.7 Flash (Low)' },
  { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)' },
  { id: 'gemini-3.1-pro-low', label: 'Gemini 3.1 Pro (Low)' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
  { id: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6 (Thinking)' },
  { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' },
];

function settingsWith(model?: string): Record<string, unknown> {
  return {
    providerConfigs: {
      agy: { discoveredModels: CATALOG, enabled: true, ...(model ? { selectedModel: model } : {}) },
    },
  };
}

describe('splitAgyModelId', () => {
  it('splits the three effort suffixes and nothing else', () => {
    expect(splitAgyModelId('gemini-3.7-flash-medium'))
      .toEqual({ baseId: 'gemini-3.7-flash', effort: 'medium' });
    expect(splitAgyModelId('claude-sonnet-4-6'))
      .toEqual({ baseId: 'claude-sonnet-4-6', effort: null });
  });

  it('does not mistake a thinking model for an effort variant', () => {
    expect(splitAgyModelId('claude-opus-4-6-thinking'))
      .toEqual({ baseId: 'claude-opus-4-6-thinking', effort: null });
  });

  it('round-trips through compose', () => {
    expect(composeAgyModelId('gemini-3.7-flash', 'low')).toBe('gemini-3.7-flash-low');
    expect(composeAgyModelId('claude-sonnet-4-6', null)).toBe('claude-sonnet-4-6');
    expect(composeAgyModelId('claude-sonnet-4-6', 'nonsense')).toBe('claude-sonnet-4-6');
  });
});

describe('buildAgyModelFamilies', () => {
  const families = buildAgyModelFamilies(CATALOG);

  it('collapses eight catalog entries into five models', () => {
    expect(families.map((family) => family.baseId)).toEqual([
      'gemini-3.7-flash',
      'gemini-3.1-pro',
      'claude-sonnet-4-6',
      'claude-opus-4-6-thinking',
      'gpt-oss-120b',
    ]);
  });

  it('strips the effort out of the label', () => {
    expect(findAgyModelFamily(families, 'gemini-3.7-flash')?.label).toBe('Gemini 3.7 Flash');
    expect(findAgyModelFamily(families, 'claude-sonnet-4-6')?.label)
      .toBe('Claude Sonnet 4.6 (Thinking)');
  });

  it('orders variants high to low, whatever order the catalog used', () => {
    expect(findAgyModelFamily(families, 'gemini-3.7-flash')?.variants.map((v) => v.effort))
      .toEqual(['high', 'medium', 'low']);
  });

  it('prefers medium, then high, when picking a default', () => {
    expect(resolveAgyDefaultEffort(findAgyModelFamily(families, 'gemini-3.7-flash')))
      .toBe('medium');
    expect(resolveAgyDefaultEffort(findAgyModelFamily(families, 'gemini-3.1-pro')))
      .toBe('high');
    expect(resolveAgyDefaultEffort(findAgyModelFamily(families, 'claude-sonnet-4-6')))
      .toBeNull();
  });
});

describe('agyChatUIConfig model and effort split', () => {
  const settings = settingsWith();

  it('lists models, not effort variants', () => {
    expect(agyChatUIConfig.getModelOptions(settings).map((option) => option.label))
      .toEqual([
        'Gemini 3.7 Flash',
        'Gemini 3.1 Pro',
        'Claude Sonnet 4.6 (Thinking)',
        'Claude Opus 4.6 (Thinking)',
        'GPT-OSS 120B',
      ]);
  });

  it('offers effort only where agy offers more than one', () => {
    expect(agyChatUIConfig.isAdaptiveReasoningModel('agy:gemini-3.7-flash', settings)).toBe(true);
    expect(agyChatUIConfig.getReasoningOptions('agy:gemini-3.7-flash', settings)
      .map((option) => option.value)).toEqual(['high', 'medium', 'low']);

    // agy publishes GPT-OSS at one effort, so there is nothing to choose.
    expect(agyChatUIConfig.isAdaptiveReasoningModel('agy:gpt-oss-120b', settings)).toBe(false);
    expect(agyChatUIConfig.getReasoningOptions('agy:claude-sonnet-4-6', settings)).toEqual([]);
  });

  it('sizes the window from the base id', () => {
    expect(agyChatUIConfig.getContextWindowSize('agy:gemini-3.7-flash', {})).toBe(1_000_000);
    expect(agyChatUIConfig.getContextWindowSize('agy:claude-sonnet-4-6', {})).toBe(250_000);
  });
});

describe('migrating selections stored before the split', () => {
  it('moves the effort suffix into the effort setting', () => {
    const settings = settingsWith('agy:gemini-3.7-flash-low');
    settings.model = 'agy:gemini-3.7-flash-low';

    expect(agySettingsReconciler.normalizeModelVariantSettings(settings)).toBe(true);
    expect(settings.model).toBe('agy:gemini-3.7-flash');
    expect(settings.effortLevel).toBe('low');
  });

  it('keeps an effort the user has already chosen', () => {
    const settings = settingsWith();
    settings.model = 'agy:gemini-3.7-flash-low';
    settings.effortLevel = 'high';

    agySettingsReconciler.normalizeModelVariantSettings(settings);
    expect(settings.effortLevel).toBe('high');
  });

  it('leaves an already-migrated selection alone', () => {
    const settings = settingsWith();
    settings.model = 'agy:gemini-3.7-flash';

    expect(agySettingsReconciler.normalizeModelVariantSettings(settings)).toBe(false);
    expect(settings.model).toBe('agy:gemini-3.7-flash');
  });
});

describe('resolveAgyLaunchModel', () => {
  it('recombines the chosen model and effort into one agy id', () => {
    expect(resolveAgyLaunchModel('gemini-3.7-flash', 'low', CATALOG))
      .toBe('gemini-3.7-flash-low');
  });

  it('never double-suffixes a selection stored before the split', () => {
    expect(resolveAgyLaunchModel('gemini-3.7-flash-medium', 'high', CATALOG))
      .toBe('gemini-3.7-flash-high');
  });

  it('drops a stale effort when the model publishes none', () => {
    // The effort setting outlives a switch from Gemini to Claude, and agy
    // rejects claude-sonnet-4-6-high outright.
    expect(resolveAgyLaunchModel('claude-sonnet-4-6', 'high', CATALOG))
      .toBe('claude-sonnet-4-6');
    expect(resolveAgyLaunchModel('claude-opus-4-6-thinking', 'low', CATALOG))
      .toBe('claude-opus-4-6-thinking');
  });

  it('substitutes the default when the model does not publish that effort', () => {
    // Gemini 3.1 Pro is offered at high and low only.
    expect(resolveAgyLaunchModel('gemini-3.1-pro', 'medium', CATALOG))
      .toBe('gemini-3.1-pro-high');
  });

  it('falls back to nothing when another provider owns the selection', () => {
    expect(resolveAgyLaunchModel(null, 'high', CATALOG)).toBeNull();
  });
});
