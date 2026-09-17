import type { App, ItemView } from 'obsidian';

import type { CanvasSelectionContext } from '../../../utils/canvas';
import type { ComposerContextTray } from '../ui/ComposerContextTray';

const CANVAS_POLL_INTERVAL = 250;

type CanvasSelectionNode = { id?: unknown };

type CanvasViewLike = ItemView & {
  canvas?: {
    selection?: Set<CanvasSelectionNode>;
  };
  file?: {
    path?: unknown;
  };
};

export class CanvasSelectionController {
  private app: App;
  private contextTray: ComposerContextTray;
  private inputEl: HTMLElement;
  private onVisibilityChange: (() => void) | null;
  private onUserSelectionChanged: (() => void) | null;
  private storedSelection: CanvasSelectionContext | null = null;
  private consumedSelection: CanvasSelectionContext | null = null;
  private pollInterval: number | null = null;

  constructor(
    app: App,
    contextTray: ComposerContextTray,
    inputEl: HTMLElement,
    onVisibilityChange?: () => void,
    onUserSelectionChanged?: () => void,
  ) {
    this.app = app;
    this.contextTray = contextTray;
    this.inputEl = inputEl;
    this.onVisibilityChange = onVisibilityChange ?? null;
    this.onUserSelectionChanged = onUserSelectionChanged ?? null;
  }

  start(): void {
    if (this.pollInterval) return;
    this.pollInterval = window.setInterval(() => this.poll(), CANVAS_POLL_INTERVAL);
  }

  stop(): void {
    if (this.pollInterval) {
      window.clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.clear();
  }

  private poll(): void {
    const canvasView = this.getCanvasView();
    if (!canvasView) return;

    const canvas = canvasView.canvas;
    if (!canvas?.selection) return;

    const selection = canvas.selection;
    const canvasPath = canvasView.file?.path;
    if (typeof canvasPath !== 'string' || !canvasPath) return;

    const nodeIds = [...selection]
      .map(node => node.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    if (nodeIds.length > 0) {
      const next = { canvasPath, nodeIds };
      if (this.isSameCanvasSelection(this.consumedSelection, next)) return;
      this.consumedSelection = null;

      if (!this.isSameCanvasSelection(this.storedSelection, next)) {
        this.storedSelection = next;
        this.updateIndicator();
        this.onUserSelectionChanged?.();
      }
    } else {
      if (this.consumedSelection?.canvasPath === canvasPath) {
        this.consumedSelection = null;
      }
      if (this.storedSelection && !this.inputEl.contains(this.getActiveElement())) {
        this.storedSelection = null;
        this.updateIndicator();
        this.onUserSelectionChanged?.();
      }
    }
  }

  private isSameCanvasSelection(
    stored: CanvasSelectionContext | null,
    next: CanvasSelectionContext,
  ): boolean {
    return stored !== null
      && stored.canvasPath === next.canvasPath
      && stored.nodeIds.length === next.nodeIds.length
      && stored.nodeIds.every(id => next.nodeIds.includes(id));
  }

  private getActiveElement(): Element | null {
    return this.inputEl.ownerDocument?.activeElement ?? null;
  }

  private getCanvasView(): CanvasViewLike | null {
    const activeLeaf = this.app.workspace.getMostRecentLeaf?.();
    const activeView = activeLeaf?.view as CanvasViewLike | undefined;
    if (activeView?.getViewType?.() === 'canvas' && activeView.file) {
      return activeView;
    }

    const leaves = this.app.workspace.getLeavesOfType('canvas');
    if (leaves.length === 0) return null;
    const leaf = leaves.find(l => (l.view as CanvasViewLike).file);
    return leaf ? (leaf.view as CanvasViewLike) : null;
  }

  private updateIndicator(): void {
    if (this.storedSelection) {
      const { nodeIds } = this.storedSelection;
      const nodeLabel = nodeIds.length === 1 ? '1 node' : `${nodeIds.length} nodes`;
      const label = `${nodeLabel} selected`;
      this.contextTray.setItems('canvas-selection', [{
        id: 'canvas-selection',
        kind: 'selection',
        label,
        icon: 'network',
        ariaLabel: label,
        onRemove: () => {
          this.consumeSelection();
          this.onUserSelectionChanged?.();
        },
      }]);
    } else {
      this.contextTray.clearItems('canvas-selection');
    }
    this.updateContextRowVisibility();
  }

  updateContextRowVisibility(): void {
    this.onVisibilityChange?.();
  }

  getContext(): CanvasSelectionContext | null {
    if (!this.storedSelection) return null;
    return {
      canvasPath: this.storedSelection.canvasPath,
      nodeIds: [...this.storedSelection.nodeIds],
    };
  }

  hasSelection(): boolean {
    return this.storedSelection !== null;
  }

  /** Drops the current selection from the chat and ignores it until it changes on the canvas. */
  consumeSelection(): void {
    if (!this.storedSelection) return;
    this.consumedSelection = this.storedSelection;
    this.clear();
  }

  /** Puts a sent selection back in the composer unless a newer one was captured since. */
  restoreSelection(context: CanvasSelectionContext | null | undefined): void {
    if (this.storedSelection || !context?.nodeIds.length) return;
    this.consumedSelection = null;
    this.storedSelection = { canvasPath: context.canvasPath, nodeIds: [...context.nodeIds] };
    this.updateIndicator();
  }

  clear(): void {
    this.storedSelection = null;
    this.updateIndicator();
  }
}
