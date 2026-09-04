import { createMockEl } from '../../../../helpers/MockElement';

const mockRenderEnvironmentSettingsSection = jest.fn();
const mockRefreshModelCatalog = jest.fn();
const mockNotices: string[] = [];

interface MockToggleComponent {
  onChangeCallback: ((value: boolean) => Promise<void> | void) | null;
  setValue: jest.Mock;
  toggleEl: any;
  onChange(callback: (value: boolean) => Promise<void> | void): MockToggleComponent;
}

interface MockTextComponent {
  inputEl: any;
  onChangeCallback: ((value: string) => Promise<void> | void) | null;
  setPlaceholder: jest.Mock;
  setValue: jest.Mock;
  onChange(callback: (value: string) => Promise<void> | void): MockTextComponent;
}

interface MockButtonComponent {
  buttonEl: any;
  disabled: boolean;
  onClickCallback: (() => Promise<void> | void) | null;
  setDisabled: jest.Mock;
  setIcon: jest.Mock;
  setTooltip: jest.Mock;
  onClick(callback: () => Promise<void> | void): MockButtonComponent;
}

interface MockDropdownComponent {
  onChangeCallback: ((value: string) => Promise<void> | void) | null;
  options: Array<[string, string]>;
  selectEl: any;
  setValue: jest.Mock;
  addOption(value: string, label: string): MockDropdownComponent;
  onChange(callback: (value: string) => Promise<void> | void): MockDropdownComponent;
}

class MockSetting {
  buttonComponents: MockButtonComponent[] = [];
  desc = '';
  dropdownComponents: MockDropdownComponent[] = [];
  heading = false;
  name = '';
  settingEl = createMockEl();
  textComponents: MockTextComponent[] = [];
  toggleComponents: MockToggleComponent[] = [];

  constructor(_container: unknown) {
    createdSettings.push(this);
  }

  setName(name: string): this {
    this.name = name;
    return this;
  }

  setDesc(desc: string): this {
    this.desc = desc;
    return this;
  }

  setHeading(): this {
    this.heading = true;
    return this;
  }

  addToggle(callback: (toggle: MockToggleComponent) => void): this {
    const component = createToggleComponent();
    this.toggleComponents.push(component);
    callback(component);
    return this;
  }

  addText(callback: (text: MockTextComponent) => void): this {
    const component = createTextComponent();
    this.textComponents.push(component);
    callback(component);
    return this;
  }

  addButton(callback: (button: MockButtonComponent) => void): this {
    const component = createButtonComponent();
    this.buttonComponents.push(component);
    callback(component);
    return this;
  }

  addDropdown(callback: (dropdown: MockDropdownComponent) => void): this {
    const component = createDropdownComponent();
    this.dropdownComponents.push(component);
    callback(component);
    return this;
  }
}

jest.mock('obsidian', () => ({
  Notice: class MockNotice {
    constructor(message: string) {
      mockNotices.push(message);
    }
  },
  Setting: MockSetting,
}));
jest.mock('@/shared/settings/EnvironmentSettingsSection', () => ({
  renderEnvironmentSettingsSection: (...args: unknown[]) =>
    mockRenderEnvironmentSettingsSection(...args),
}));
jest.mock('@/providers/agy/app/AgyWorkspaceServices', () => ({
  getAgyWorkspaceServices: jest.fn(() => ({
    cliResolver: { reset: jest.fn() },
    refreshModelCatalog: mockRefreshModelCatalog,
  })),
}));

import { getAgyProviderSettings } from '@/providers/agy/settings';
import { agySettingsTabRenderer } from '@/providers/agy/ui/AgySettingsTab';

const createdSettings: MockSetting[] = [];

function createToggleComponent(): MockToggleComponent {
  const component = {} as MockToggleComponent;
  component.onChangeCallback = null;
  component.toggleEl = createMockEl();
  component.setValue = jest.fn(() => component);
  component.onChange = (callback) => {
    component.onChangeCallback = callback;
    return component;
  };
  return component;
}

function createTextComponent(): MockTextComponent {
  const component = {} as MockTextComponent;
  component.inputEl = createMockEl('input');
  component.onChangeCallback = null;
  component.setPlaceholder = jest.fn(() => component);
  component.setValue = jest.fn((value: string) => {
    component.inputEl.value = value;
    return component;
  });
  component.onChange = (callback) => {
    component.onChangeCallback = callback;
    return component;
  };
  return component;
}

function createButtonComponent(): MockButtonComponent {
  const component = {} as MockButtonComponent;
  component.buttonEl = createMockEl('button');
  component.disabled = false;
  component.onClickCallback = null;
  component.setDisabled = jest.fn((value: boolean) => {
    component.disabled = value;
    return component;
  });
  component.setIcon = jest.fn(() => component);
  component.setTooltip = jest.fn(() => component);
  component.onClick = (callback) => {
    component.onClickCallback = callback;
    return component;
  };
  return component;
}

function createDropdownComponent(): MockDropdownComponent {
  const component = {} as MockDropdownComponent;
  component.onChangeCallback = null;
  component.options = [];
  component.selectEl = createMockEl('select');
  component.selectEl.empty = jest.fn(() => {
    component.options = [];
  });
  component.setValue = jest.fn(() => component);
  component.addOption = (value: string, label: string) => {
    component.options.push([value, label]);
    return component;
  };
  component.onChange = (callback) => {
    component.onChangeCallback = callback;
    return component;
  };
  return component;
}

function createContext(settings: Record<string, unknown>) {
  const saveSettings = jest.fn().mockResolvedValue(undefined);
  const mutateSettings = jest.fn(async (mutation: (current: any) => void | Promise<void>) => {
    await mutation(settings);
    await saveSettings();
  });
  const applyProviderRuntimeSettings = jest.fn(async (
    _providerIds: string[],
    mutation: (current: any) => void | Promise<void>,
    onApplied?: () => void | Promise<void>,
  ) => {
    await mutateSettings(mutation);
    await onApplied?.();
  });
  return {
    plugin: {
      applyProviderRuntimeSettings,
      mutateSettings,
      saveSettings,
      settings,
    },
    notifyProviderModelOptionsChanged: jest.fn(),
    renderCustomContextLimits: jest.fn(),
  };
}

function render(settings: Record<string, unknown>) {
  const context = createContext(settings);
  agySettingsTabRenderer.render(createMockEl() as unknown as HTMLElement, context as any);
  return context;
}

function findSetting(name: string): MockSetting {
  const setting = [...createdSettings].reverse().find(
    entry => entry.name === name && !entry.heading,
  );
  if (!setting) {
    throw new Error(`Setting not found: ${name}`);
  }
  return setting;
}

function settingsWithModels(): Record<string, unknown> {
  return {
    providerConfigs: {
      agy: {
        discoveredModels: [
          { id: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash (High)' },
          { id: 'gemini-3.7-flash-low', label: 'Gemini 3.7 Flash (Low)' },
          { id: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6 (Thinking)' },
        ],
        enabled: true,
        selectedModel: 'agy:claude-opus-4-6-thinking',
      },
    },
  };
}

describe('AgySettingsTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createdSettings.length = 0;
    mockNotices.length = 0;
    mockRefreshModelCatalog.mockResolvedValue({ changed: false, models: [] });
  });

  it('offers one default-model option per model family and shows the stored selection', () => {
    render(settingsWithModels());

    const dropdown = findSetting('Default model').dropdownComponents[0];
    expect(dropdown.options).toEqual([
      ['agy:gemini-3.7-flash', 'Gemini 3.7 Flash'],
      ['agy:claude-opus-4-6-thinking', 'Claude Opus 4.6 (Thinking)'],
    ]);
    expect(dropdown.setValue).toHaveBeenLastCalledWith('agy:claude-opus-4-6-thinking');
  });

  it('persists a newly chosen default model', async () => {
    const settings = settingsWithModels();
    const context = render(settings);

    await findSetting('Default model').dropdownComponents[0]
      .onChangeCallback?.('agy:gemini-3.7-flash');

    expect(getAgyProviderSettings(settings).selectedModel).toBe('agy:gemini-3.7-flash');
    expect(context.plugin.saveSettings).toHaveBeenCalled();
    expect(context.notifyProviderModelOptionsChanged).toHaveBeenCalledWith('agy');
  });

  it('names the refresh control on a non-submit native button', () => {
    render(settingsWithModels());

    const button = findSetting('Default model').buttonComponents[0];
    expect(button.buttonEl.getAttribute('type')).toBe('button');
    expect(button.buttonEl.getAttribute('aria-label')).toBe('Refresh agy models');
    expect(button.setTooltip).toHaveBeenCalledWith('Refresh agy models');
  });

  it('repopulates the default-model options from a refreshed catalog', async () => {
    const settings = settingsWithModels();
    const context = render(settings);
    const modelSetting = findSetting('Default model');
    const dropdown = modelSetting.dropdownComponents[0];
    mockRefreshModelCatalog.mockImplementation(async () => {
      (settings.providerConfigs as any).agy.discoveredModels = [
        { id: 'gemini-4-pro-high', label: 'Gemini 4 Pro (High)' },
      ];
      return { changed: true, models: [] };
    });

    await modelSetting.buttonComponents[0].onClickCallback?.();

    expect(dropdown.selectEl.empty).toHaveBeenCalled();
    expect(dropdown.options).toEqual([['agy:gemini-4-pro', 'Gemini 4 Pro']]);
    expect(context.notifyProviderModelOptionsChanged).toHaveBeenCalledWith('agy');
  });

  it('leaves the options untouched when the refreshed catalog is unchanged', async () => {
    const context = render(settingsWithModels());
    const modelSetting = findSetting('Default model');
    const dropdown = modelSetting.dropdownComponents[0];
    dropdown.selectEl.empty.mockClear();

    await modelSetting.buttonComponents[0].onClickCallback?.();

    expect(dropdown.selectEl.empty).not.toHaveBeenCalled();
    expect(dropdown.options).toHaveLength(2);
    expect(context.notifyProviderModelOptionsChanged).not.toHaveBeenCalled();
  });

  it('reports a failed catalog refresh and keeps the current options', async () => {
    render(settingsWithModels());
    const modelSetting = findSetting('Default model');
    mockRefreshModelCatalog.mockResolvedValue({
      changed: false,
      diagnostics: 'the agy CLI was not found',
      models: [],
    });

    await modelSetting.buttonComponents[0].onClickCallback?.();

    expect(mockNotices).toEqual(['agy model discovery failed: the agy CLI was not found']);
    expect(modelSetting.dropdownComponents[0].options).toHaveLength(2);
    expect(modelSetting.buttonComponents[0].disabled).toBe(false);
  });
});
