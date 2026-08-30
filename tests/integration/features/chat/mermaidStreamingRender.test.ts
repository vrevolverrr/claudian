import { createMockEl } from '@test/helpers/MockElement';
import { MarkdownRenderer } from 'obsidian';

import { DEFAULT_CHAT_PROVIDER_ID } from '@/core/providers/types';
import type { ChatMessage } from '@/core/types';
import {
  StreamController,
  type StreamControllerDeps,
} from '@/features/chat/controllers/StreamController';
import { MessageRenderer } from '@/features/chat/rendering/MessageRenderer';
import { ChatState } from '@/features/chat/state/ChatState';

const MERMAID_CONTENT = ['```mermaid', 'graph TD', '  A --> B', '```'].join('\n');

const originalWindow = (globalThis as { window?: Window }).window;

function installTestWindow(): void {
  const testWindow = {
    requestAnimationFrame: (callback: FrameRequestCallback): number =>
      globalThis.setTimeout(() => callback(performance.now()), 16) as unknown as number,
    cancelAnimationFrame: (handle: number): void => {
      globalThis.clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
    },
    setTimeout: (callback: () => void, timeout: number): number =>
      globalThis.setTimeout(callback, timeout) as unknown as number,
    clearTimeout: (handle: number): void => {
      globalThis.clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
    },
    setInterval: (callback: () => void, timeout: number): number =>
      globalThis.setInterval(callback, timeout) as unknown as number,
    clearInterval: (handle: number): void => {
      globalThis.clearInterval(handle as unknown as ReturnType<typeof setInterval>);
    },
  } as Window;

  Object.defineProperty(globalThis, 'window', { value: testWindow, configurable: true });
}

function createDeps(): StreamControllerDeps {
  const messagesEl = createMockEl();
  const plugin = {
    settings: { mediaFolder: '', permissionMode: 'yolo' },
    app: { loadLocalStorage: jest.fn().mockReturnValue(true) },
  } as any;
  const renderer = new MessageRenderer(
    plugin,
    { registerDomEvent: jest.fn(), register: jest.fn() } as any,
    messagesEl as any,
  );

  return {
    plugin,
    state: new ChatState(),
    renderer,
    subagentManager: {} as any,
    getMessagesEl: () => messagesEl as any,
    getFileContextManager: () => null,
    updateQueueIndicator: jest.fn(),
    getProviderId: () => DEFAULT_CHAT_PROVIDER_ID,
  };
}

function renderedMarkdownAt(index: number): string {
  return (MarkdownRenderer.renderMarkdown as jest.Mock).mock.calls[index][0];
}

describe('mermaid rendering across the streaming coordinator and the message renderer', () => {
  let deps: StreamControllerDeps;
  let controller: StreamController;

  beforeAll(() => {
    installTestWindow();
  });

  afterAll(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: Window }).window;
      return;
    }
    Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    deps = createDeps();
    controller = new StreamController(deps);
    deps.state.currentContentEl = createMockEl() as any;
  });

  afterEach(() => {
    controller.dispose();
    jest.useRealTimers();
  });

  it('neutralizes the fence while streaming and lets it through once the block completes', async () => {
    const msg: ChatMessage = {
      id: 'msg-1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };

    await controller.appendText(MERMAID_CONTENT);
    jest.advanceTimersByTime(16);
    await Promise.resolve();
    await Promise.resolve();

    expect(renderedMarkdownAt(0)).toContain('```claudian-display-only-fence-0');
    expect(renderedMarkdownAt(0)).not.toContain('```mermaid');

    jest.advanceTimersByTime(150);
    await controller.finalizeCurrentTextBlock(msg);

    const calls = (MarkdownRenderer.renderMarkdown as jest.Mock).mock.calls;
    expect(calls.length).toBeGreaterThan(1);
    expect(renderedMarkdownAt(calls.length - 1)).toContain('```mermaid');
  });
});
