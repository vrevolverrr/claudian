import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import { normalizeHostnameStringMap } from '../../core/providers/settings/HostnameStringMap';
import {
  readStoredBoolean,
  readStoredString,
} from '../../core/providers/settings/storedSettings';
import type { HostnameCliPaths } from '../../core/types/settings';

export interface PersistedAgyProviderSettings {
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  enabled: boolean;
  environmentVariables: string;
  selectedModel: string;
}

export type AgyProviderSettings = PersistedAgyProviderSettings;

export const DEFAULT_AGY_PROVIDER_SETTINGS: Readonly<PersistedAgyProviderSettings> =
  Object.freeze({
    cliPath: '',
    cliPathsByHost: {},
    enabled: false,
    environmentVariables: '',
    selectedModel: '',
  });

export function getAgyProviderSettings(
  settings: Record<string, unknown>,
): AgyProviderSettings {
  const config = getProviderConfig(settings, 'agy');

  return {
    cliPath: readStoredString(config.cliPath, DEFAULT_AGY_PROVIDER_SETTINGS.cliPath),
    cliPathsByHost: normalizeHostnameStringMap(config.cliPathsByHost),
    enabled: readStoredBoolean(config.enabled, DEFAULT_AGY_PROVIDER_SETTINGS.enabled),
    environmentVariables: readStoredString(
      config.environmentVariables,
      getProviderEnvironmentVariables(settings, 'agy')
        ?? DEFAULT_AGY_PROVIDER_SETTINGS.environmentVariables,
    ),
    selectedModel: readStoredString(
      config.selectedModel,
      DEFAULT_AGY_PROVIDER_SETTINGS.selectedModel,
    ),
  };
}

export function updateAgyProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<PersistedAgyProviderSettings>,
): void {
  setProviderConfig(settings, 'agy', {
    ...getAgyProviderSettings(settings),
    ...updates,
  });
}
