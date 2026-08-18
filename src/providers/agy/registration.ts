import { NOOP_TASK_RESULT_INTERPRETER } from '../../core/providers/NoopTaskResultInterpreter';
import { getProviderConfig } from '../../core/providers/providerConfig';
import { hasStoredConfigNormalization } from '../../core/providers/settings/storedSettings';
import type { ProviderModule } from '../../core/providers/types';
import { agyWorkspaceRegistration } from './app/AgyWorkspaceServices';
import { AGY_PROVIDER_CAPABILITIES } from './capabilities';
import { agySettingsReconciler } from './env/AgySettingsReconciler';
import { AgyExecutionBackend } from './execution/AgyExecutionBackend';
import { AgyConversationHistoryService } from './history/AgyConversationHistoryService';
import { getAgyProviderSettings, updateAgyProviderSettings } from './settings';
import { agySubagentAdapter } from './subagentAdapter';
import { agyChatUIConfig } from './ui/AgyChatUIConfig';

export const agyProviderRegistration: ProviderModule = {
  id: 'agy',
  blankTabOrder: 60,
  capabilities: AGY_PROVIDER_CAPABILITIES,
  chatUIConfig: agyChatUIConfig,
  createExecutionBackend: (plugin) => new AgyExecutionBackend(plugin),
  displayName: 'agy',
  environmentKeyPatterns: [/^AGY_/i, /^ANTIGRAVITY_/i],
  historyService: new AgyConversationHistoryService(),
  isEnabled: (settings) => getAgyProviderSettings(settings).enabled,
  setEnabled: (settings, enabled) => updateAgyProviderSettings(settings, { enabled }),
  settingsReconciler: agySettingsReconciler,
  settingsStorage: {
    hostScopedFields: ['cliPathsByHost'],
    normalizeStored(target, stored) {
      const storedConfig = getProviderConfig(stored, 'agy');
      updateAgyProviderSettings(target, getAgyProviderSettings(stored));
      return hasStoredConfigNormalization(storedConfig, getProviderConfig(target, 'agy'));
    },
  },
  subagentAdapter: agySubagentAdapter,
  taskResultInterpreter: NOOP_TASK_RESULT_INTERPRETER,
  workspace: agyWorkspaceRegistration,
};
