const MAX_REMEMBERED_SOURCES = 10;

/**
 * Selections already sent or dismissed from the chat, at most one per source
 * (editor, note, page, or canvas). Each stays ignored until its own source shows
 * a different selection or none, so selecting elsewhere does not bring it back.
 */
export class ConsumedSelections<T> {
  private entries: T[] = [];

  constructor(
    private readonly sourceOf: (selection: T) => unknown,
    private readonly isSame: (left: T, right: T) => boolean,
  ) {}

  remember(selection: T): void {
    const source = this.sourceOf(selection);
    this.entries = [
      selection,
      ...this.entries.filter(entry => this.sourceOf(entry) !== source),
    ].slice(0, MAX_REMEMBERED_SOURCES);
  }

  /** Whether an observed selection was already consumed; a different one releases its source. */
  isConsumed(candidate: T): boolean {
    const source = this.sourceOf(candidate);
    const entry = this.entries.find(remembered => this.sourceOf(remembered) === source);
    if (entry && this.isSame(entry, candidate)) return true;
    this.release(source);
    return false;
  }

  release(source: unknown): void {
    this.entries = this.entries.filter(entry => this.sourceOf(entry) !== source);
  }

  take(predicate: (selection: T) => boolean): T | undefined {
    const entry = this.entries.find(predicate);
    if (entry !== undefined) {
      this.entries = this.entries.filter(remembered => remembered !== entry);
    }
    return entry;
  }
}
