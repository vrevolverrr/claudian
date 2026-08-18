export const AGY_MODEL_PREFIX = 'agy:';

/** Fallback for a model whose family is not recognised. */
export const AGY_DEFAULT_CONTEXT_WINDOW = 200_000;

/**
 * Context window per model family.
 *
 * agy reports no window of its own — its usage records carry token counts and
 * nothing else — so these are published figures for the underlying models, not
 * values agy confirmed. They are only used to scale the context meter, and the
 * per-model context limits in settings override any of them.
 */
const CONTEXT_WINDOWS: ReadonlyArray<readonly [string, number]> = Object.freeze([
  ['gemini-', 1_000_000],
  ['claude-', 200_000],
  ['gpt-oss-', 128_000],
]);

export function resolveAgyContextWindow(rawModelId: string): number {
  const match = CONTEXT_WINDOWS.find(([prefix]) => rawModelId.startsWith(prefix));
  return match ? match[1] : AGY_DEFAULT_CONTEXT_WINDOW;
}

export interface AgyModel {
  readonly id: string;
  readonly label: string;
}

/**
 * Fallback catalog, captured from `agy models`.
 *
 * agy bakes reasoning effort into the model id, so effort is a model choice
 * here rather than a separate control. Discovery replaces this list whenever
 * agy can be reached; it exists so the selector is never empty.
 */
export const AGY_FALLBACK_MODELS: readonly AgyModel[] = Object.freeze([
  { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)' },
  { id: 'gemini-3.1-pro-low', label: 'Gemini 3.1 Pro (Low)' },
  { id: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash (High)' },
  { id: 'gemini-3.7-flash-medium', label: 'Gemini 3.7 Flash (Medium)' },
  { id: 'gemini-3.7-flash-low', label: 'Gemini 3.7 Flash (Low)' },
  { id: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6 (Thinking)' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
  { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' },
]);

export function encodeAgyModelId(modelId: string): string {
  const normalized = modelId.trim();
  return normalized ? `${AGY_MODEL_PREFIX}${normalized}` : '';
}

/**
 * agy serves models whose bare ids collide with other providers' — its catalog
 * includes `claude-sonnet-4-6` — so a selection is only ever owned when it
 * carries the prefix.
 */
export function decodeAgyModelId(model: string): string | null {
  if (!model.startsWith(AGY_MODEL_PREFIX)) return null;
  const raw = model.slice(AGY_MODEL_PREFIX.length).trim();
  return raw || null;
}

export function isAgyModelSelectionId(model: string): boolean {
  return decodeAgyModelId(model) !== null;
}

/**
 * Parses `agy models` output: one `id<TAB>label` row per model, preceded by
 * progress lines that carry no tab.
 */
export function parseAgyModelCatalog(output: string): AgyModel[] {
  const models: AgyModel[] = [];
  const seen = new Set<string>();

  for (const line of output.split('\n')) {
    const separator = line.indexOf('\t');
    if (separator <= 0) continue;

    const id = line.slice(0, separator).trim();
    const label = line.slice(separator + 1).trim();
    if (!id || seen.has(id)) continue;

    seen.add(id);
    models.push({ id, label: label || id });
  }

  return models;
}

export function normalizeAgyDiscoveredModels(value: unknown): AgyModel[] {
  if (!Array.isArray(value)) return [];

  const models: AgyModel[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;

    const record = entry as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    if (!id || seen.has(id)) continue;

    const label = typeof record.label === 'string' ? record.label.trim() : '';
    seen.add(id);
    models.push({ id, label: label || id });
  }

  return models;
}

export function getEffectiveAgyModels(discovered: readonly AgyModel[]): AgyModel[] {
  return discovered.length > 0 ? [...discovered] : [...AGY_FALLBACK_MODELS];
}
