/** @jest-environment jsdom */

import { BrowserSelectionController } from '@/features/chat/controllers/BrowserSelectionController';

function createMockContextTray() {
  return {
    setItems: jest.fn(),
    clearItems: jest.fn(),
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('BrowserSelectionController', () => {
  let controller: BrowserSelectionController;
  let app: any;
  let contextTray: ReturnType<typeof createMockContextTray>;
  let inputEl: HTMLTextAreaElement;
  let containerEl: HTMLElement;
  let selectionText = 'selected web snippet';
  let getSelectionSpy: jest.SpyInstance;
  let browserView: { currentUrl: string };

  beforeEach(() => {
    jest.useFakeTimers();
    selectionText = 'selected web snippet';

    contextTray = createMockContextTray();
    inputEl = document.createElement('textarea');
    document.body.appendChild(inputEl);
    containerEl = document.createElement('div');
    const selectionAnchor = document.createElement('span');
    containerEl.appendChild(selectionAnchor);

    getSelectionSpy = jest.spyOn(document, 'getSelection').mockImplementation(() => ({
      toString: () => selectionText,
      anchorNode: selectionAnchor,
      focusNode: selectionAnchor,
    } as unknown as Selection));

    const view = {
      getViewType: () => 'surfing-view',
      getDisplayText: () => 'Surfing',
      containerEl,
      currentUrl: 'https://example.com',
    };
    browserView = view;

    app = {
      workspace: {
        activeLeaf: { view },
        getMostRecentLeaf: jest.fn(() => ({ view })),
      },
    };

    controller = new BrowserSelectionController(app, contextTray as any, inputEl);
  });

  afterEach(() => {
    controller.stop();
    inputEl.remove();
    getSelectionSpy.mockRestore();
    jest.useRealTimers();
  });

  it('captures browser selection and updates indicator', async () => {
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    expect(controller.getContext()).toEqual({
      source: 'browser:https://example.com',
      selectedText: 'selected web snippet',
      title: 'Surfing',
      url: 'https://example.com',
    });
    expect(contextTray.setItems).toHaveBeenLastCalledWith('browser-selection', [
      expect.objectContaining({
        label: '1 line selected',
      }),
    ]);
    expect(contextTray.setItems.mock.calls[0][1][0]).not.toHaveProperty('title');
  });

  it('shows line-based indicator text for multi-line browser selection', async () => {
    selectionText = 'line 1\nline 2';
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    expect(contextTray.setItems).toHaveBeenLastCalledWith('browser-selection', [
      expect.objectContaining({ label: '2 lines selected' }),
    ]);
  });

  it('clears selection when text is deselected and input is not focused', async () => {
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();
    expect(controller.hasSelection()).toBe(true);

    selectionText = '';
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    expect(controller.hasSelection()).toBe(false);
    expect(contextTray.clearItems).toHaveBeenCalledWith('browser-selection');
  });

  it('keeps selection while input is focused', async () => {
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();
    expect(controller.hasSelection()).toBe(true);

    selectionText = '';
    inputEl.focus();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    expect(controller.hasSelection()).toBe(true);
  });

  it('clears selection when clear is called', async () => {
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();
    expect(controller.hasSelection()).toBe(true);

    controller.clear();

    expect(controller.hasSelection()).toBe(false);
    expect(contextTray.clearItems).toHaveBeenCalledWith('browser-selection');
  });

  it('clears selection from the tray remove action', async () => {
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    const items = contextTray.setItems.mock.calls[0][1];
    items[0].onRemove();

    expect(controller.hasSelection()).toBe(false);
    expect(contextTray.clearItems).toHaveBeenCalledWith('browser-selection');
  });

  describe('consumed selections', () => {
    async function poll(): Promise<void> {
      jest.advanceTimersByTime(250);
      await flushMicrotasks();
    }

    async function captureSelection(): Promise<void> {
      controller.start();
      await poll();
      expect(controller.hasSelection()).toBe(true);
    }

    it('does not re-capture a consumed browser selection', async () => {
      await captureSelection();

      controller.consumeSelection();
      expect(controller.hasSelection()).toBe(false);
      expect(contextTray.clearItems).toHaveBeenCalledWith('browser-selection');
      await poll();
      await poll();

      expect(controller.hasSelection()).toBe(false);
    });

    it('captures again after the page selection is cleared and reselected', async () => {
      await captureSelection();
      controller.consumeSelection();

      selectionText = '';
      await poll();
      selectionText = 'selected web snippet';
      await poll();

      expect(controller.getContext()?.selectedText).toBe('selected web snippet');
    });

    it('does not bring back a sent selection after selecting on another page', async () => {
      await captureSelection();
      controller.consumeSelection();

      browserView.currentUrl = 'https://other.example';
      selectionText = 'other page text';
      await poll();
      expect(controller.getContext()?.selectedText).toBe('other page text');

      browserView.currentUrl = 'https://example.com';
      selectionText = 'selected web snippet';
      await poll();

      expect(controller.getContext()).toBeNull();
    });

    it('keeps a still-selected page out of the composer after tray remove', async () => {
      await captureSelection();

      contextTray.setItems.mock.calls.at(-1)![1][0].onRemove();
      await poll();

      expect(controller.hasSelection()).toBe(false);
    });

    it('restores a consumed browser selection', async () => {
      await captureSelection();
      const sent = controller.getContext();
      controller.consumeSelection();

      controller.restoreSelection(sent);

      expect(controller.getContext()).toEqual(sent);
      expect(contextTray.setItems).toHaveBeenLastCalledWith('browser-selection', [
        expect.objectContaining({ label: '1 line selected' }),
      ]);
      await poll();
      expect(controller.getContext()).toEqual(sent);
    });

    it('does not replace a newer browser selection when restoring', async () => {
      await captureSelection();
      const sent = controller.getContext();
      controller.consumeSelection();
      selectionText = 'newer snippet';
      await poll();

      controller.restoreSelection(sent);

      expect(controller.getContext()?.selectedText).toBe('newer snippet');
    });
  });

  it('handles polling errors without unhandled rejection', async () => {
    const extractSpy = jest.spyOn(controller as any, 'extractSelectedText')
      .mockRejectedValueOnce(new Error('poll failed'));

    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    expect(extractSpy).toHaveBeenCalled();
    expect(controller.hasSelection()).toBe(false);
  });
});
