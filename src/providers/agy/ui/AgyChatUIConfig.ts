import type {
  ProviderChatUIConfig,
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import {
  AGY_DEFAULT_CONTEXT_WINDOW,
  decodeAgyModelId,
  encodeAgyModelId,
  getEffectiveAgyModels,
  isAgyModelSelectionId,
} from '../models';
import { getAgyProviderSettings, updateAgyProviderSettings } from '../settings';

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

export const agyChatUIConfig: ProviderChatUIConfig = {
  applyModelDefaults(model, settings): void {
    if (!isAgyModelSelectionId(model)) return;
    updateAgyProviderSettings(
      settings as Record<string, unknown>,
      { selectedModel: model },
    );
  },

  applyPermissionMode(): void {
    // Permission mode is read from the shared setting at launch time; agy keeps
    // no mode of its own between turns.
  },

  getContextWindowSize(model, customLimits): number {
    const rawId = decodeAgyModelId(model);
    const configured = rawId ? customLimits?.[rawId] : undefined;
    return configured && configured > 0 ? configured : AGY_DEFAULT_CONTEXT_WINDOW;
  },

  getCustomModelIds(): Set<string> {
    // agy resolves its own catalog; environment variables never name models.
    return new Set<string>();
  },

  getDefaultModel(settings): string | null {
    const agySettings = getAgyProviderSettings(settings);
    if (isAgyModelSelectionId(agySettings.selectedModel)) {
      return agySettings.selectedModel;
    }

    const first = getEffectiveAgyModels(agySettings.discoveredModels)[0];
    return first ? encodeAgyModelId(first.id) : null;
  },

  getDefaultReasoningValue(): string {
    return '';
  },

  getModelOptions(settings): ProviderUIOption[] {
    return getEffectiveAgyModels(getAgyProviderSettings(settings).discoveredModels)
      .map((model) => ({
        label: model.label,
        value: encodeAgyModelId(model.id),
      }));
  },

  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return AGY_PERMISSION_MODE_TOGGLE;
  },

  getReasoningOptions(): ProviderReasoningOption[] {
    // agy encodes reasoning effort in the model id, so there is nothing to pick.
    return [];
  },

  isAdaptiveReasoningModel(): boolean {
    return false;
  },

  isDefaultModel(model): boolean {
    return isAgyModelSelectionId(model);
  },

  normalizeModelVariant(model, settings): string {
    if (!isAgyModelSelectionId(model)) return model;

    const options = agyChatUIConfig.getModelOptions(settings);
    return options.some((option) => option.value === model)
      ? model
      : agyChatUIConfig.getDefaultModel?.(settings) ?? model;
  },

  ownsModel(model): boolean {
    return isAgyModelSelectionId(model);
  },
};
