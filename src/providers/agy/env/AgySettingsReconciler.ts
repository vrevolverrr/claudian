import {
  createCliPathFingerprintInputs,
  hasCliPathFingerprintInputs,
} from '../../../core/providers/cli/CliPathFingerprintInputs';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { createRuntimeInputFingerprint } from '../../../core/providers/settings/RuntimeInputFingerprint';
import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { getHostnameKey, parseEnvironmentVariables } from '../../../utils/env';
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

  normalizeModelVariantSettings(): boolean {
    // agy has no model variants: reasoning effort is part of the model id.
    return false;
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
