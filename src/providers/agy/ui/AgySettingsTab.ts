import { type DropdownComponent, Notice, Setting } from 'obsidian';

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
import { getAgyProviderSettings, updateAgyProviderSettings } from '../settings';
import { agyChatUIConfig } from './AgyChatUIConfig';

const AGY_PROVIDER_ID = 'agy' as const;
const REFRESH_MODELS_LABEL = 'Refresh agy models';

export const agySettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container: HTMLElement, context: ProviderSettingsTabRendererContext): void {
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const hostnameKey = getHostnameKey();
    const workspace = getAgyWorkspaceServices();

    const warningEl = container.createDiv({ cls: 'claudian-settings-warning-callout' });
    warningEl.createDiv({
      cls: 'claudian-settings-warning-callout-title',
      text: 'Read before enabling',
    });
    warningEl.createDiv({
      text: 'agy runs one non-interactive turn per message, so it cannot pause to ask '
        + 'for approval. In Plan and No-edits modes it denies file writes and shell '
        + 'commands and reports them as failed; only YOLO lets them run, without a '
        + 'confirmation step. Google\'s terms also do not permit third-party tools '
        + 'to access Antigravity, and using this may put your account at risk.',
    });

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

    const modelSetting = new Setting(container)
      .setName('Default model')
      .setDesc('The model new agy conversations start with. Choosing another '
        + 'model in chat updates this too; reasoning effort stays per conversation.');

    let modelDropdown!: DropdownComponent;
    const renderModelOptions = (): void => {
      modelDropdown.selectEl.empty();
      for (const option of agyChatUIConfig.getModelOptions(settingsBag)) {
        modelDropdown.addOption(option.value, option.label);
      }
      modelDropdown.setValue(agyChatUIConfig.getDefaultModel?.(settingsBag) ?? '');
    };

    modelSetting.addDropdown((dropdown) => {
      modelDropdown = dropdown;
      renderModelOptions();
      dropdown.onChange(async (selectedModel) => {
        await context.plugin.mutateSettings((settings) => {
          updateAgyProviderSettings(settings, { selectedModel });
        });
        context.notifyProviderModelOptionsChanged(AGY_PROVIDER_ID);
      });
    });

    modelSetting.addButton((button) => {
      button
        .setIcon('refresh-cw')
        .setTooltip(REFRESH_MODELS_LABEL)
        .onClick(async () => {
          button.setDisabled(true);
          try {
            const result = await workspace.refreshModelCatalog();
            if (result.diagnostics) {
              new Notice(`agy model discovery failed: ${result.diagnostics}`);
              return;
            }
            if (!result.changed) {
              return;
            }
            renderModelOptions();
            context.notifyProviderModelOptionsChanged(AGY_PROVIDER_ID);
          } finally {
            button.setDisabled(false);
          }
        });
      button.buttonEl.setAttribute('type', 'button');
      button.buttonEl.setAttribute('aria-label', REFRESH_MODELS_LABEL);
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
