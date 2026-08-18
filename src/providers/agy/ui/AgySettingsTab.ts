import { Notice, Setting } from 'obsidian';

import type {
  ProviderSettingsTabRenderer,
  ProviderSettingsTabRendererContext,
} from '../../../core/providers/types';
import type { ClaudianSettings } from '../../../core/types';
import { renderEnvironmentSettingsSection } from '../../../shared/settings/EnvironmentSettingsSection';
import { renderHostnameCliPathSetting } from '../../../shared/settings/HostnameCliPathSetting';
import { renderProviderEnablementSetting } from '../../../shared/settings/ProviderEnablementSetting';
import { getHostnameKey } from '../../../utils/env';
import { getAgyWorkspaceServices } from '../app/AgyWorkspaceServices';
import { getEffectiveAgyModels } from '../models';
import { getAgyProviderSettings, updateAgyProviderSettings } from '../settings';

const AGY_PROVIDER_ID = 'agy' as const;

export const agySettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container: HTMLElement, context: ProviderSettingsTabRendererContext): void {
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const hostnameKey = getHostnameKey();
    const workspace = getAgyWorkspaceServices();

    renderProviderEnablementSetting({
      container,
      description: 'Run Google\'s Antigravity CLI (agy) inside your vault.',
      getValue: () => getAgyProviderSettings(settingsBag).enabled,
      name: 'Enable agy',
      onChange: async (enabled) => {
        await context.plugin.mutateSettings((settings) => {
          updateAgyProviderSettings(
            settings,
            { enabled },
          );
        });
      },
    });

    const notice = container.createDiv({
      cls: 'claudian-setting-validation claudian-setting-validation-warning',
    });
    notice.setText(
      'agy runs one non-interactive turn per message, so it cannot pause to ask '
      + 'for approval. In Plan and No-edits modes it denies file writes and shell '
      + 'commands and reports them as failed; only YOLO lets them run, without a '
      + 'confirmation step. Google\'s terms also do not permit third-party tools '
      + 'to access Antigravity, and using this may put your account at risk.',
    );

    renderHostnameCliPathSetting({
      container,
      description: 'Optional absolute path to the agy binary for this computer. '
        + 'Leave empty to use `agy` from PATH.',
      getValue: () => {
        const current = getAgyProviderSettings(settingsBag);
        return current.cliPathsByHost[hostnameKey] ?? current.cliPath ?? '';
      },
      name: 'CLI path',
      onChange: async (value) => {
        const cliPathsByHost = {
          ...getAgyProviderSettings(settingsBag).cliPathsByHost,
        };
        if (value) {
          cliPathsByHost[hostnameKey] = value;
        } else {
          delete cliPathsByHost[hostnameKey];
        }

        await context.plugin.applyProviderRuntimeSettings(
          [AGY_PROVIDER_ID],
          (settings: ClaudianSettings) => {
            updateAgyProviderSettings(
              settings,
              { cliPath: '', cliPathsByHost },
            );
          },
          () => workspace.cliResolver.reset(),
        );
        context.notifyProviderModelOptionsChanged(AGY_PROVIDER_ID);
      },
      placeholder: process.platform === 'win32'
        ? 'C:\\Users\\you\\AppData\\Local\\Antigravity\\agy.exe'
        : '~/.local/bin/agy',
    });

    new Setting(container).setName('Models').setHeading();

    const modelList = container.createDiv({ cls: 'claudian-agy-model-list' });
    const renderModelList = (): void => {
      const models = getEffectiveAgyModels(
        getAgyProviderSettings(settingsBag).discoveredModels,
      );
      modelList.empty();
      for (const model of models) {
        modelList.createDiv({ text: `${model.label} — ${model.id}` });
      }
    };
    renderModelList();

    new Setting(container)
      .setName('Refresh model list')
      .setDesc('Reads the catalog agy offers for your account.')
      .addButton((button) => {
        button.setButtonText('Refresh').onClick(async () => {
          button.setDisabled(true);
          try {
            const result = await workspace.refreshModelCatalog();
            if (result.diagnostics) {
              new Notice(`agy model discovery failed: ${result.diagnostics}`);
              return;
            }
            renderModelList();
            context.notifyProviderModelOptionsChanged(AGY_PROVIDER_ID);
          } finally {
            button.setDisabled(false);
          }
        });
      });

    renderEnvironmentSettingsSection({
      container,
      desc: 'Environment variables passed only to agy.',
      heading: 'Environment',
      name: 'agy environment variables',
      placeholder: 'GOOGLE_CLOUD_PROJECT=my-project',
      plugin: context.plugin,
      renderCustomContextLimits: (target) =>
        context.renderCustomContextLimits(target, AGY_PROVIDER_ID),
      scope: `provider:${AGY_PROVIDER_ID}`,
    });
  },
};
