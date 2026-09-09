import { agySettingsReconciler } from '@/providers/agy/env/AgySettingsReconciler';
import { resolveAgyLaunchModel } from '@/providers/agy/execution/AgyExecutionSession';
import {
  buildAgyModelFamilies,
  composeAgyModelId,
  findAgyModelFamily,
  resolveAgyDefaultEffort,
  splitAgyModelId,
  splitAgyModelVersion,
} from '@/providers/agy/models';
import { agyChatUIConfig } from '@/providers/agy/ui/AgyChatUIConfig';

/** A copy of what `agy models` prints (agy 1.1.19). */
const CATALOG = [
  { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
  { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
  { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
  { id: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash (High)' },
  { id: 'gemini-3.7-flash-medium', label: 'Gemini 3.7 Flash (Medium)' },
  { id: 'gemini-3.7-flash-low', label: 'Gemini 3.7 Flash (Low)' },
  { id: 'gemini-3.6-flash-high', label: 'Gemini 3.6 Flash (High)' },
  { id: 'gemini-3.6-flash-medium', label: 'Gemini 3.6 Flash (Medium)' },
  { id: 'gemini-3.6-flash-low', label: 'Gemini 3.6 Flash (Low)' },
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

describe('splitAgyModelVersion', () => {
  it('lifts a version out of the middle or the end of an id', () => {
    expect(splitAgyModelVersion('gemini-3.8-flash'))
      .toEqual({ familyId: 'gemini-flash', version: [3, 8] });
    expect(splitAgyModelVersion('claude-sonnet-4-6'))
      .toEqual({ familyId: 'claude-sonnet', version: [4, 6] });
    expect(splitAgyModelVersion('claude-opus-4-6-thinking'))
      .toEqual({ familyId: 'claude-opus-thinking', version: [4, 6] });
  });

  it('leaves a size alone: 120b is not a version', () => {
    expect(splitAgyModelVersion('gpt-oss-120b'))
      .toEqual({ familyId: 'gpt-oss-120b', version: [] });
  });
});

describe('buildAgyModelFamilies', () => {
  const families = buildAgyModelFamilies(CATALOG);

  it('collapses fourteen catalog entries into five models', () => {
    expect(families.map((family) => family.familyId)).toEqual([
      'gemini-flash',
      'gemini-pro',
      'claude-sonnet',
      'claude-opus-thinking',
      'gpt-oss-120b',
    ]);
  });

  it('keeps only the newest version of a family', () => {
    const flash = findAgyModelFamily(families, 'gemini-flash');
    expect(flash?.rawId).toBe('gemini-3.8-flash');
    expect(flash?.variants.map((variant) => variant.rawId)).toEqual([
      'gemini-3.8-flash-high',
      'gemini-3.8-flash-medium',
      'gemini-3.8-flash-low',
    ]);
  });

  it('names the version the family resolves to', () => {
    expect(findAgyModelFamily(families, 'gemini-flash')?.label).toBe('Gemini 3.8 Flash');
    expect(findAgyModelFamily(families, 'claude-sonnet')?.label)
      .toBe('Claude Sonnet 4.6 (Thinking)');
  });

  it('picks the newest version whatever order the catalog lists them in', () => {
    // agy prints newest first, but that ordering is not a documented contract.
    const reversed = buildAgyModelFamilies([...CATALOG].reverse());
    const flash = findAgyModelFamily(reversed, 'gemini-flash');

    expect(flash?.rawId).toBe('gemini-3.8-flash');
    expect(flash?.label).toBe('Gemini 3.8 Flash');
    expect(flash?.variants.map((variant) => variant.rawId)).toEqual([
      'gemini-3.8-flash-high',
      'gemini-3.8-flash-medium',
      'gemini-3.8-flash-low',
    ]);
  });

  it('finds a family from a concrete id stored before the collapse', () => {
    expect(findAgyModelFamily(families, 'gemini-3.6-flash-low')?.familyId)
      .toBe('gemini-flash');
  });

  it('orders variants high to low, whatever order the catalog used', () => {
    expect(findAgyModelFamily(families, 'gemini-flash')?.variants.map((v) => v.effort))
      .toEqual(['high', 'medium', 'low']);
  });

  it('prefers medium, then high, when picking a default', () => {
    expect(resolveAgyDefaultEffort(findAgyModelFamily(families, 'gemini-flash')))
      .toBe('medium');
    expect(resolveAgyDefaultEffort(findAgyModelFamily(families, 'gemini-pro')))
      .toBe('high');
    expect(resolveAgyDefaultEffort(findAgyModelFamily(families, 'claude-sonnet')))
      .toBeNull();
  });
});

describe('agyChatUIConfig model and effort split', () => {
  const settings = settingsWith();

  it('lists one entry per family, not per version or effort', () => {
    const options = agyChatUIConfig.getModelOptions(settings)
      .map(({ label, value }) => ({ label, value }));
    expect(options).toEqual([
      { label: 'Gemini 3.8 Flash', value: 'agy:gemini-flash' },
      { label: 'Gemini 3.1 Pro', value: 'agy:gemini-pro' },
      { label: 'Claude Sonnet 4.6 (Thinking)', value: 'agy:claude-sonnet' },
      { label: 'Claude Opus 4.6 (Thinking)', value: 'agy:claude-opus-thinking' },
      { label: 'GPT-OSS 120B', value: 'agy:gpt-oss-120b' },
    ]);
  });

  it('offers effort only where agy offers more than one', () => {
    expect(agyChatUIConfig.isAdaptiveReasoningModel('agy:gemini-flash', settings)).toBe(true);
    expect(agyChatUIConfig.getReasoningOptions('agy:gemini-flash', settings)
      .map((option) => option.value)).toEqual(['high', 'medium', 'low']);

    // agy publishes GPT-OSS at one effort, so there is nothing to choose.
    expect(agyChatUIConfig.isAdaptiveReasoningModel('agy:gpt-oss-120b', settings)).toBe(false);
    expect(agyChatUIConfig.getReasoningOptions('agy:claude-sonnet', settings)).toEqual([]);
  });

  it('sizes the window from the family id', () => {
    expect(agyChatUIConfig.getContextWindowSize('agy:gemini-flash', {})).toBe(1_000_000);
    expect(agyChatUIConfig.getContextWindowSize('agy:claude-sonnet', {})).toBe(250_000);
  });

  it('snaps a selection stored against one version onto its family', () => {
    expect(agyChatUIConfig.normalizeModelVariant('agy:gemini-3.6-flash', settings))
      .toBe('agy:gemini-flash');
    expect(agyChatUIConfig.getDefaultModel?.(settingsWith('agy:gemini-3.1-pro')))
      .toBe('agy:gemini-pro');
  });

  it('falls back to the first family when the selection is gone entirely', () => {
    expect(agyChatUIConfig.getDefaultModel?.(settingsWith('agy:retired-model')))
      .toBe('agy:gemini-flash');
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
    settings.model = 'agy:gemini-flash';

    expect(agySettingsReconciler.normalizeModelVariantSettings(settings)).toBe(false);
    expect(settings.model).toBe('agy:gemini-flash');
  });
});

describe('resolveAgyLaunchModel', () => {
  it('resolves a family to the newest version at the chosen effort', () => {
    expect(resolveAgyLaunchModel('gemini-flash', 'low', CATALOG))
      .toBe('gemini-3.8-flash-low');
  });

  it('upgrades a selection pinned to an older version', () => {
    expect(resolveAgyLaunchModel('gemini-3.6-flash-medium', 'high', CATALOG))
      .toBe('gemini-3.8-flash-high');
  });

  it('drops a stale effort when the model publishes none', () => {
    // The effort setting outlives a switch from Gemini to Claude, and agy
    // rejects claude-sonnet-4-6-high outright.
    expect(resolveAgyLaunchModel('claude-sonnet', 'high', CATALOG))
      .toBe('claude-sonnet-4-6');
    expect(resolveAgyLaunchModel('claude-opus-thinking', 'low', CATALOG))
      .toBe('claude-opus-4-6-thinking');
  });

  it('substitutes the default when the model does not publish that effort', () => {
    // Gemini 3.1 Pro is offered at high and low only.
    expect(resolveAgyLaunchModel('gemini-pro', 'medium', CATALOG))
      .toBe('gemini-3.1-pro-high');
  });

  it('passes a selection the catalog does not know through untouched', () => {
    expect(resolveAgyLaunchModel('gemini-9.9-flash', 'high', [])).toBe('gemini-9.9-flash');
  });

  it('falls back to nothing when another provider owns the selection', () => {
    expect(resolveAgyLaunchModel(null, 'high', CATALOG)).toBeNull();
  });
});
