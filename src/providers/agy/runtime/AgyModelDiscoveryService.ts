import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import type { ProviderModelCatalogRefreshResult } from '../../../core/providers/types';
import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';
import { type AgyModel, parseAgyModelCatalog } from '../models';
import { getAgyProviderSettings, updateAgyProviderSettings } from '../settings';
import { AgyCliResolver } from './AgyCliResolver';

const execFileAsync = promisify(execFile);
const DISCOVERY_TIMEOUT_MS = 30_000;
const OUTPUT_LIMIT_BYTES = 256 * 1024;

export interface AgyModelDiscoveryResult extends ProviderModelCatalogRefreshResult {
  readonly models: AgyModel[];
  /** Empty when the binary could not be reached or did not report one. */
  readonly cliVersion?: string;
}

/**
 * Reads agy's catalog with `agy models`, which prints one `id<TAB>label` row
 * per model. The catalog is stored in settings so the model selector survives
 * a restart without shelling out again.
 */
export class AgyModelDiscoveryService {
  constructor(
    private readonly host: ProviderHost,
    private readonly cliResolver = new AgyCliResolver(),
  ) {}

  /**
   * Discovery for the settings pane, which is rendered only after this
   * resolves. `agy models` takes seconds, so it runs only when it can change
   * something: the provider is on and no catalog has been read yet. The
   * explicit refresh control calls `refresh()` and always shells out.
   */
  async ensureFresh(): Promise<AgyModelDiscoveryResult> {
    const settings = this.host.settings as unknown as Record<string, unknown>;
    const agySettings = getAgyProviderSettings(settings);
    if (!agySettings.enabled || agySettings.discoveredModels.length > 0) {
      return { changed: false, models: [...agySettings.discoveredModels] };
    }

    return this.refresh();
  }

  private async readCliVersion(
    cliPath: string,
    environment: NodeJS.ProcessEnv,
  ): Promise<string> {
    try {
      const { stdout } = await execFileAsync(cliPath, ['--version'], {
        env: environment,
        maxBuffer: OUTPUT_LIMIT_BYTES,
        timeout: DISCOVERY_TIMEOUT_MS,
      });
      return stdout.trim().split('\n')[0]?.trim() ?? '';
    } catch {
      // A version this build cannot read is reported as unknown, never fatal.
      return '';
    }
  }

  async refresh(): Promise<AgyModelDiscoveryResult> {
    const settings = this.host.settings as unknown as Record<string, unknown>;
    const cliPath = this.cliResolver.resolveFromSettings(settings);
    if (!cliPath) {
      return { changed: false, diagnostics: 'the agy CLI was not found', models: [] };
    }

    const environment: NodeJS.ProcessEnv = (() => {
      const configured = parseEnvironmentVariables(
        getRuntimeEnvironmentText(settings, 'agy'),
      );
      return {
        ...process.env,
        ...configured,
        PATH: getEnhancedPath(configured.PATH, cliPath),
      };
    })();

    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(cliPath, ['models'], {
        env: environment,
        maxBuffer: OUTPUT_LIMIT_BYTES,
        timeout: DISCOVERY_TIMEOUT_MS,
      }));
    } catch (error) {
      return {
        changed: false,
        diagnostics: error instanceof Error ? error.message : String(error),
        models: [],
      };
    }

    const models = parseAgyModelCatalog(stdout);
    if (models.length === 0) {
      return { changed: false, diagnostics: 'agy listed no models', models: [] };
    }

    const changed = !sameModelCatalog(
      models,
      getAgyProviderSettings(settings).discoveredModels,
    );
    if (changed) {
      await this.host.mutateSettings((mutable) => {
        updateAgyProviderSettings(
          mutable,
          { discoveredModels: models },
        );
      });
    }

    return { changed, models, persistedSettingsChanged: changed };
  }
}

function sameModelCatalog(
  left: readonly AgyModel[],
  right: readonly AgyModel[],
): boolean {
  return left.length === right.length
    && left.every((model, index) =>
      model.id === right[index]?.id && model.label === right[index]?.label);
}
