import { CachedProviderCliResolver } from '../../../core/providers/cli/CachedProviderCliResolver';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { getAgyProviderSettings } from '../settings';

export class AgyCliResolver {
  private readonly resolver = new CachedProviderCliResolver({
    binaryName: 'agy',
    getSettingsProjection: (settings) => {
      const providerSettings = getAgyProviderSettings(settings);
      return {
        cliPathsByHost: providerSettings.cliPathsByHost,
        environmentText: getRuntimeEnvironmentText(settings, 'agy'),
        legacyCliPath: providerSettings.cliPath,
      };
    },
    providerId: 'agy',
  });

  resolveFromSettings(settings: Record<string, unknown>): string | null {
    return this.resolver.resolveFromSettings(settings);
  }

  reset(): void {
    this.resolver.reset();
  }
}
