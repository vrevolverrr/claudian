import { isRecord } from '@/utils/frontmatter';

interface SelectionQuote {
  label: string;
  href?: string;
  external?: boolean;
  text?: string;
}

/**
 * Renders the editor, browser, and canvas selections a user message was sent with.
 * The context comes from persisted conversation data, so every field is checked
 * before use and selected text is shown as plain text, never as Markdown.
 */
export function renderSelectionQuotes(parentEl: HTMLElement, context: unknown): void {
  const quotes = readSelectionQuotes(context);
  if (quotes.length === 0) return;

  const groupEl = parentEl.createDiv({
    cls: 'claudian-selection-quotes',
    attr: { role: 'group', 'aria-label': 'Quoted selection' },
  });
  for (const quote of quotes) {
    const quoteEl = groupEl.createDiv({ cls: 'claudian-selection-quote' });
    if (quote.href && quote.external) {
      quoteEl.createEl('a', {
        cls: 'claudian-selection-quote-source external-link',
        text: quote.label,
        attr: { href: quote.href, target: '_blank', rel: 'noopener' },
      });
    } else if (quote.href) {
      // Opened by the delegated registerFileLinkHandler on the messages container.
      quoteEl.createEl('a', {
        cls: 'claudian-selection-quote-source claudian-file-link',
        text: quote.label,
        attr: { href: quote.href, 'data-href': quote.href },
      });
    } else {
      quoteEl.createSpan({ cls: 'claudian-selection-quote-source', text: quote.label });
    }
    if (quote.text) {
      quoteEl.createDiv({ cls: 'claudian-selection-quote-text', text: quote.text });
    }
  }
}

function readSelectionQuotes(context: unknown): SelectionQuote[] {
  if (!isRecord(context)) return [];
  return [
    readEditorQuote(context.editorSelection),
    readBrowserQuote(context.browserSelection),
    readCanvasQuote(context.canvasSelection),
  ].filter((quote): quote is SelectionQuote => quote !== null);
}

function readEditorQuote(value: unknown): SelectionQuote | null {
  if (!isRecord(value) || !isNonEmptyString(value.notePath) || !isNonEmptyString(value.selectedText)) {
    return null;
  }
  const { notePath, lineCount, startLine } = value;
  let label = notePath;
  if (isPositiveInteger(startLine) && isPositiveInteger(lineCount)) {
    label = lineCount === 1
      ? `${notePath} · line ${startLine}`
      : `${notePath} · lines ${startLine}–${startLine + lineCount - 1}`;
  }
  return { label, href: notePath, text: value.selectedText.trim() };
}

function readBrowserQuote(value: unknown): SelectionQuote | null {
  if (!isRecord(value) || !isNonEmptyString(value.selectedText)) return null;
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  const url = typeof value.url === 'string' ? value.url.trim() : '';
  return {
    label: title || url || 'Web page',
    ...(/^https?:\/\//i.test(url) ? { href: url, external: true } : {}),
    text: value.selectedText.trim(),
  };
}

function readCanvasQuote(value: unknown): SelectionQuote | null {
  if (
    !isRecord(value)
    || !isNonEmptyString(value.canvasPath)
    || !Array.isArray(value.nodeIds)
    || value.nodeIds.length === 0
    || !value.nodeIds.every(isNonEmptyString)
  ) {
    return null;
  }
  const count = value.nodeIds.length;
  return {
    label: `${value.canvasPath} · ${count} node${count === 1 ? '' : 's'}`,
    href: value.canvasPath,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
