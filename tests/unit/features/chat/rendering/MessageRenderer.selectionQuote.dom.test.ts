/** @jest-environment jsdom */

import '@/providers';

import { fireEvent, within } from '@testing-library/dom';
import { axe } from 'jest-axe';
import { MarkdownRenderer } from 'obsidian';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { ChatMessage, ExecutionInputContextSnapshot } from '@/core/types';
import { MessageRenderer } from '@/features/chat/rendering/MessageRenderer';

HTMLElement.prototype.appendText = function (text) { this.append(document.createTextNode(text)); };
HTMLElement.prototype.empty = function () { this.replaceChildren(); };
HTMLElement.prototype.addClass = function (...classes) { this.classList.add(...classes); };

function setup() {
  const messagesEl = document.body.createDiv();
  const app = {
    metadataCache: { getFirstLinkpathDest: jest.fn().mockReturnValue(null) },
    workspace: { iterateAllLeaves: jest.fn(), openLinkText: jest.fn().mockResolvedValue(undefined) },
  };
  const renderer = new MessageRenderer(
    { app, settings: { mediaFolder: '', showMessageTimestamps: true } } as any,
    { registerDomEvent: jest.fn(), register: jest.fn(), addChild: jest.fn() } as any,
    messagesEl, undefined, undefined, () => ProviderRegistry.getCapabilities('claude'),
  );
  return { app, messagesEl, renderer };
}

function userMessage(context: unknown, text = 'Can you rewrite this?'): ChatMessage {
  return {
    id: 'u1',
    role: 'user',
    content: text,
    displayContent: text,
    timestamp: 1,
    executionInput: {
      schemaVersion: 1,
      canonicalText: text,
      context: context as ExecutionInputContextSnapshot,
    },
  };
}

function bubble(messagesEl: HTMLElement): HTMLElement {
  return messagesEl.querySelector<HTMLElement>('[data-message-id="u1"]')!;
}

const EDITOR_SELECTION = {
  notePath: 'Notes/foo.md',
  mode: 'selection' as const,
  selectedText: 'The quick brown fox',
  lineCount: 6,
  startLine: 10,
};

beforeEach(() => {
  document.body.replaceChildren();
  jest.mocked(MarkdownRenderer.render).mockImplementation(async (_app, markdown, el) => {
    (el as HTMLElement).createEl('p', { text: markdown });
  });
});

it('quotes an editor selection above the message text in a live bubble', async () => {
  const { messagesEl, renderer } = setup();

  renderer.addMessage(userMessage({ editorSelection: EDITOR_SELECTION }));
  await Promise.resolve();

  const quote = within(bubble(messagesEl)).getByRole('group', { name: 'Quoted selection' });
  expect(within(quote).getByRole('link', { name: 'Notes/foo.md · lines 10–15' })).toBeTruthy();
  expect(within(quote).getByText('The quick brown fox')).toBeTruthy();
  const textBlock = bubble(messagesEl).querySelector('.claudian-text-block')!;
  expect(quote.compareDocumentPosition(textBlock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(textBlock.textContent).toBe('Can you rewrite this?');
  expect((await axe(bubble(messagesEl))).violations).toEqual([]);
  renderer.dispose();
});

it('quotes the same selection when the conversation is reopened', () => {
  const { messagesEl, renderer } = setup();

  renderer.renderMessages([userMessage({ editorSelection: EDITOR_SELECTION })], () => 'Hello');

  const quote = within(bubble(messagesEl)).getByRole('group', { name: 'Quoted selection' });
  expect(within(quote).getByRole('link', { name: 'Notes/foo.md · lines 10–15' })).toBeTruthy();
  expect(within(quote).getByText('The quick brown fox')).toBeTruthy();
  renderer.dispose();
});

it('labels a one-line selection with its line', () => {
  const { messagesEl, renderer } = setup();

  renderer.addMessage(userMessage({
    editorSelection: { ...EDITOR_SELECTION, lineCount: 1, startLine: 4 },
  }));

  expect(within(bubble(messagesEl)).getByRole('link', { name: 'Notes/foo.md · line 4' })).toBeTruthy();
  renderer.dispose();
});

it('labels a selection without line numbers with its path only', () => {
  const { messagesEl, renderer } = setup();

  renderer.addMessage(userMessage({
    editorSelection: {
      notePath: 'Courses/a.pdf',
      mode: 'selection',
      selectedText: 'pdf text',
      lineCount: 1,
    },
  }));

  expect(within(bubble(messagesEl)).getByRole('link', { name: 'Courses/a.pdf' })).toBeTruthy();
  renderer.dispose();
});

it('opens the quoted note when its label is clicked', () => {
  const { app, messagesEl, renderer } = setup();
  renderer.addMessage(userMessage({ editorSelection: EDITOR_SELECTION }));

  fireEvent.click(within(bubble(messagesEl)).getByRole('link', { name: 'Notes/foo.md · lines 10–15' }));

  expect(app.workspace.openLinkText).toHaveBeenCalledWith('Notes/foo.md', '', 'tab');
  renderer.dispose();
});

it('links a browser quote only to http pages', () => {
  const { messagesEl, renderer } = setup();
  const browserSelection = {
    source: 'browser:https://example.com',
    selectedText: 'web snippet',
    title: 'Example',
    url: 'https://example.com',
  };

  renderer.addMessage(userMessage({ browserSelection }));
  const pageLink = within(bubble(messagesEl)).getByRole('link', { name: 'Example' });
  expect(pageLink.getAttribute('href')).toBe('https://example.com');
  expect(within(bubble(messagesEl)).getByText('web snippet')).toBeTruthy();

  renderer.renderMessages([userMessage({
    browserSelection: { ...browserSelection, url: 'javascript:alert(1)' },
  })], () => 'Hello');
  const quote = within(bubble(messagesEl)).getByRole('group', { name: 'Quoted selection' });
  expect(within(quote).queryByRole('link')).toBeNull();
  expect(within(quote).getByText('Example')).toBeTruthy();
  renderer.dispose();
});

it('quotes a canvas selection by node count', () => {
  const { messagesEl, renderer } = setup();

  renderer.addMessage(userMessage({
    canvasSelection: { canvasPath: 'boards/x.canvas', nodeIds: ['a', 'b'] },
  }));

  const quote = within(bubble(messagesEl)).getByRole('group', { name: 'Quoted selection' });
  expect(within(quote).getByRole('link', { name: 'boards/x.canvas · 2 nodes' })).toBeTruthy();
  expect(quote.querySelector('.claudian-selection-quote-text')).toBeNull();
  renderer.dispose();
});

it('ignores malformed saved selection context', () => {
  const { messagesEl, renderer } = setup();

  renderer.renderMessages([userMessage({
    editorSelection: { notePath: 3, selectedText: {} },
    browserSelection: { selectedText: 42 },
    canvasSelection: { canvasPath: 'x.canvas', nodeIds: 'a' },
  })], () => 'Hello');

  expect(within(bubble(messagesEl)).queryByRole('group', { name: 'Quoted selection' })).toBeNull();
  expect(bubble(messagesEl).querySelector('.claudian-text-block')).not.toBeNull();
  renderer.dispose();
});

it('keeps the quote when a live user message is updated', () => {
  const { messagesEl, renderer } = setup();
  const msg = userMessage({ editorSelection: EDITOR_SELECTION });
  renderer.addMessage(msg);

  renderer.updateLiveUserMessage(msg);

  expect(within(bubble(messagesEl)).getAllByRole('group', { name: 'Quoted selection' })).toHaveLength(1);
  renderer.dispose();
});
