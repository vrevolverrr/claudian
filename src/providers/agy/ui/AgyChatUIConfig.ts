import type {
  ProviderChatUIConfig,
  ProviderIconSvg,
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import { CLAUDE_PROVIDER_ICON, GEMINI_PROVIDER_ICON, OPENAI_PROVIDER_ICON } from '../../../shared/icons';
import {
  AGY_DEFAULT_CONTEXT_WINDOW,
  type AgyModelFamily,
  buildAgyModelFamilies,
  decodeAgyModelId,
  encodeAgyModelId,
  findAgyModelFamily,
  getEffectiveAgyModels,
  isAgyModelSelectionId,
  resolveAgyContextWindow,
  resolveAgyDefaultEffort,
} from '../models';
import { getAgyProviderSettings, updateAgyProviderSettings } from '../settings';

/**
 * agy mixes several underlying model families behind one provider, so a
 * single provider-wide icon would misrepresent every family but one. Keyed
 * on the family id's prefix, which survives the version-stripping in
 * `splitAgyModelVersion` (`gemini-3.1-pro` -> `gemini-pro`).
 */
const FAMILY_ICONS_BY_PREFIX: ReadonlyArray<readonly [string, ProviderIconSvg]> = Object.freeze([
  ['gemini-', GEMINI_PROVIDER_ICON],
  ['claude-', CLAUDE_PROVIDER_ICON],
  ['gpt-oss-', OPENAI_PROVIDER_ICON],
]);

function resolveAgyFamilyIcon(familyId: string): ProviderIconSvg | undefined {
  return FAMILY_ICONS_BY_PREFIX.find(([prefix]) => familyId.startsWith(prefix))?.[1];
}

/**
 * Print mode cannot ask for approval, so Safe means "agy denies edits and
 * reports them" rather than "agy asks". The labels say so: a user who wants
 * edits applied has to choose YOLO deliberately.
 */
const AGY_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  activeLabel: 'YOLO',
  activeValue: 'yolo',
  inactiveLabel: 'No edits',
  inactiveValue: 'normal',
  planLabel: 'Plan',
  planValue: 'plan',
};

function getFamilies(settings: Record<string, unknown>): AgyModelFamily[] {
  return buildAgyModelFamilies(
    getEffectiveAgyModels(getAgyProviderSettings(settings).discoveredModels),
  );
}

/** The family a selection names, or null when another provider owns it. */
function getSelectedFamily(
  model: string,
  settings: Record<string, unknown>,
): AgyModelFamily | null {
  const rawId = decodeAgyModelId(model);
  return rawId ? findAgyModelFamily(getFamilies(settings), rawId) : null;
}

export const agyChatUIConfig: ProviderChatUIConfig = {
  applyModelDefaults(model, settings): void {
    if (!isAgyModelSelectionId(model)) return;
    updateAgyProviderSettings(
      settings as Record<string, unknown>,
      { selectedModel: model },
    );
  },

  getContextWindowSize(model, customLimits): number {
    const baseId = decodeAgyModelId(model);
    if (!baseId) return AGY_DEFAULT_CONTEXT_WINDOW;

    const configured = customLimits?.[baseId];
    return configured && configured > 0 ? configured : resolveAgyContextWindow(baseId);
  },

  getCustomModelIds(): Set<string> {
    // agy resolves its own catalog; environment variables never name models.
    return new Set<string>();
  },

  getDefaultModel(settings): string | null {
    // Answering with the family id rather than the stored selection is what
    // migrates a selection pinned to one version onto the collapsed entry.
    const family = getSelectedFamily(getAgyProviderSettings(settings).selectedModel, settings)
      ?? getFamilies(settings)[0];
    return family ? encodeAgyModelId(family.familyId) : null;
  },

  getDefaultReasoningValue(model, settings): string {
    return resolveAgyDefaultEffort(getSelectedFamily(model, settings)) ?? '';
  },

  getModelOptions(settings): ProviderUIOption[] {
    return getFamilies(settings).map((family) => ({
      label: family.label,
      providerIcon: resolveAgyFamilyIcon(family.familyId),
      value: encodeAgyModelId(family.familyId),
    }));
  },

  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return AGY_PERMISSION_MODE_TOGGLE;
  },

  getReasoningOptions(model, settings): ProviderReasoningOption[] {
    const family = getSelectedFamily(model, settings);
    if (!family || family.variants.length < 2) return [];

    return family.variants.map((variant) => ({
      label: variant.label,
      value: variant.effort,
    }));
  },

  isAdaptiveReasoningModel(model, settings): boolean {
    // A model agy offers at a single effort has nothing to choose between.
    return (getSelectedFamily(model, settings)?.variants.length ?? 0) > 1;
  },

  isDefaultModel(model): boolean {
    return isAgyModelSelectionId(model);
  },

  normalizeModelVariant(model, settings): string {
    if (!isAgyModelSelectionId(model)) return model;

    const family = getSelectedFamily(model, settings);
    return family
      ? encodeAgyModelId(family.familyId)
      : agyChatUIConfig.getDefaultModel?.(settings) ?? model;
  },

  ownsModel(model): boolean {
    return isAgyModelSelectionId(model);
  },

  resolvePermissionMode(settings): string {
    if (settings.permissionMode === 'plan') return 'plan';
    return settings.permissionMode === 'yolo' ? 'yolo' : 'normal';
  },
};
