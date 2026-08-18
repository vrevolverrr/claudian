import {
  createCliPathFingerprintInputs,
  hasCliPathFingerprintInputs,
} from '../../../core/providers/cli/CliPathFingerprintInputs';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { createRuntimeInputFingerprint } from '../../../core/providers/settings/RuntimeInputFingerprint';
import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { getHostnameKey, parseEnvironmentVariables } from '../../../utils/env';
import {
  composeAgyModelId,
  decodeAgyModelId,
  encodeAgyModelId,
  isAgyModelSelectionId,
  splitAgyModelId,
} from '../models';
import { getAgyProviderSettings, updateAgyProviderSettings } from '../settings';
import { getAgyState } from '../types';

/**
 * agy resolves its own account, project and model catalog, so PATH and the
 * configured binary are the only inputs that can move a conversation to a
 * different agy installation.
 */
const AGY_ENV_HASH_KEYS = ['PATH'] as const;

function invalidateAgyConversationSessions(conversations: Conversation[]): Conversation[] {
  const invalidated: Conversation[] = [];

  for (const conversation of conversations) {
    if (conversation.providerId !== 'agy') continue;
    if (!conversation.sessionId && !getAgyState(conversation.providerState).conversationId) {
      continue;
    }

    conversation.sessionId = null;
    conversation.providerState = undefined;
    invalidated.push(conversation);
  }

  return invalidated;
}

export const agySettingsReconciler: ProviderSettingsReconciler = {
  invalidateConversationSessions: invalidateAgyConversationSessions,

  /**
   * Migrates selections stored before model and effort were separated.
   *
   * A stored `agy:gemini-3.7-flash-medium` names a model that the selector no
   * longer lists; it becomes `agy:gemini-3.7-flash` with `medium` moved to the
   * effort setting, so an existing conversation keeps the model it was using.
   */
  normalizeModelVariantSettings(settings: Record<string, unknown>): boolean {
    let changed = false;

    const migrate = (value: unknown): string | null => {
      if (typeof value !== 'string' || !isAgyModelSelectionId(value)) return null;

      const rawId = decodeAgyModelId(value);
      if (!rawId) return null;

      const { baseId, effort } = splitAgyModelId(rawId);
      if (!effort) return null;

      if (typeof settings.effortLevel !== 'string' || !settings.effortLevel.trim()) {
        settings.effortLevel = effort;
      }
      return encodeAgyModelId(composeAgyModelId(baseId, null));
    };

    const model = migrate(settings.model);
    if (model) {
      settings.model = model;
      changed = true;
    }

    const titleModel = migrate(settings.titleGenerationModel);
    if (titleModel) {
      settings.titleGenerationModel = titleModel;
      changed = true;
    }

    const saved = settings.savedProviderModel;
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      const savedModels = saved as Record<string, unknown>;
      const migrated = migrate(savedModels.agy);
      if (migrated) {
        savedModels.agy = migrated;
        changed = true;
      }
    }

    const providerSettings = getAgyProviderSettings(settings);
    const selected = migrate(providerSettings.selectedModel);
    if (selected) {
      updateAgyProviderSettings(settings, { selectedModel: selected });
      changed = true;
    }

    return changed;
  },

  reconcileModelWithEnvironment(
    settings: Record<string, unknown>,
    conversations: Conversation[],
  ): { changed: boolean; invalidatedConversations: Conversation[] } {
    const environmentText = getRuntimeEnvironmentText(settings, 'agy');
    const agySettings = getAgyProviderSettings(settings);
    const cliPathInputs = createCliPathFingerprintInputs(
      agySettings.cliPathsByHost[getHostnameKey()],
      agySettings.cliPath,
    );
    const currentHash = createRuntimeInputFingerprint({
      additionalInputs: cliPathInputs,
      environmentKeys: AGY_ENV_HASH_KEYS,
      environmentText,
    });

    const environment = parseEnvironmentVariables(environmentText);
    const hasFingerprintInputs = hasCliPathFingerprintInputs(cliPathInputs)
      || AGY_ENV_HASH_KEYS.some(
        (key) => Object.prototype.hasOwnProperty.call(environment, key),
      );

    if (!agySettings.environmentHash && !hasFingerprintInputs) {
      return { changed: false, invalidatedConversations: [] };
    }
    if (currentHash === agySettings.environmentHash) {
      return { changed: false, invalidatedConversations: [] };
    }

    const invalidatedConversations = invalidateAgyConversationSessions(conversations);
    updateAgyProviderSettings(settings, { environmentHash: currentHash });
    return { changed: true, invalidatedConversations };
  },
};
