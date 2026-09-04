export const AGY_MODEL_PREFIX = 'agy:';

/** Fallback for a model whose family is not recognised. */
export const AGY_DEFAULT_CONTEXT_WINDOW = 250_000;

/**
 * Context window per model family, as agy serves them.
 *
 * agy's stream carries token counts and no window, so these cannot be read at
 * runtime; they are the limits agy reports for its own models rather than the
 * underlying models' published figures, which differ. The per-model context
 * limits in settings override any of them.
 */
const CONTEXT_WINDOWS: ReadonlyArray<readonly [string, number]> = Object.freeze([
  ['gemini-', 1_000_000],
  ['claude-', 250_000],
  ['gpt-oss-', 131_072],
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

/**
 * agy publishes one catalog entry per effort level rather than an effort
 * control: `gemini-3.7-flash-high`, `-medium`, `-low` are three entries for one
 * model. They are split back apart so the model selector lists models and the
 * reasoning selector lists effort.
 *
 * Only these three suffixes count. `claude-opus-4-6-thinking` is its own model,
 * not an effort variant of `claude-opus-4-6`.
 */
export const AGY_EFFORT_LEVELS = ['high', 'medium', 'low'] as const;

export type AgyEffortLevel = typeof AGY_EFFORT_LEVELS[number];

const EFFORT_LABELS: Readonly<Record<AgyEffortLevel, string>> = Object.freeze({
  high: 'High',
  low: 'Low',
  medium: 'Medium',
});

/** Preference order when the stored effort is missing or no longer offered. */
const EFFORT_FALLBACK_ORDER: readonly AgyEffortLevel[] = ['medium', 'high', 'low'];

export interface AgyModelVariant {
  readonly effort: AgyEffortLevel;
  readonly label: string;
  readonly rawId: string;
}

export interface AgyModelFamily {
  /** Version-free selection id, e.g. `gemini-flash`. */
  readonly familyId: string;
  readonly label: string;
  /** Newest catalog id for the family, with no effort suffix. */
  readonly rawId: string;
  readonly variants: readonly AgyModelVariant[];
}

/**
 * agy serves several versions of one model at once — 3.8, 3.7 and 3.6 Flash —
 * and only the newest is worth offering. A selection therefore names the
 * family and the newest catalog entry answers to it, so a stored selection
 * never goes stale when agy ships a new version. agy itself has no such alias
 * and rejects an id it does not serve, so the resolution happens here.
 *
 * A segment is a version only when it is nothing but digits and dots: that
 * lifts `3.8` out of the middle of `gemini-3.8-flash` and `4-6` off the end of
 * `claude-sonnet-4-6`, while leaving the size in `gpt-oss-120b` alone.
 */
const VERSION_SEGMENT = /^\d+(?:\.\d+)*$/;

export function splitAgyModelVersion(baseId: string): {
  familyId: string;
  version: number[];
} {
  const version: number[] = [];
  const rest: string[] = [];

  for (const segment of baseId.split('-')) {
    if (VERSION_SEGMENT.test(segment)) {
      version.push(...segment.split('.').map(Number));
    } else {
      rest.push(segment);
    }
  }

  return { familyId: rest.join('-') || baseId, version };
}

function compareAgyVersions(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function splitAgyModelId(rawModelId: string): {
  baseId: string;
  effort: AgyEffortLevel | null;
} {
  for (const effort of AGY_EFFORT_LEVELS) {
    const suffix = `-${effort}`;
    if (rawModelId.endsWith(suffix) && rawModelId.length > suffix.length) {
      return { baseId: rawModelId.slice(0, -suffix.length), effort };
    }
  }
  return { baseId: rawModelId, effort: null };
}

export function composeAgyModelId(
  baseId: string,
  effort: string | null | undefined,
): string {
  return isAgyEffortLevel(effort) ? `${baseId}-${effort}` : baseId;
}

export function isAgyEffortLevel(value: unknown): value is AgyEffortLevel {
  return typeof value === 'string'
    && (AGY_EFFORT_LEVELS as readonly string[]).includes(value);
}

/** Strips the effort out of a catalog label: "Gemini 3.7 Flash (High)". */
function stripEffortLabel(label: string, effort: AgyEffortLevel): string {
  const parenthetical = ` (${EFFORT_LABELS[effort]})`;
  return label.endsWith(parenthetical)
    ? label.slice(0, -parenthetical.length)
    : label;
}

export function buildAgyModelFamilies(
  models: readonly AgyModel[],
): AgyModelFamily[] {
  const families = new Map<string, {
    label: string;
    rawId: string;
    variants: AgyModelVariant[];
    version: number[];
  }>();

  for (const model of models) {
    const { baseId, effort } = splitAgyModelId(model.id);
    const { familyId, version } = splitAgyModelVersion(baseId);

    const known = families.get(familyId);
    const comparison = known ? compareAgyVersions(version, known.version) : 1;
    if (comparison < 0) continue;

    // A newer version replaces what an older one contributed rather than
    // merging with it: the efforts a family offers can change between versions.
    const family = comparison === 0 && known
      ? known
      : { label: '', rawId: baseId, variants: [], version };

    if (effort === null) {
      family.label = model.label;
    } else {
      family.label ||= stripEffortLabel(model.label, effort);
      family.variants.push({
        effort,
        label: EFFORT_LABELS[effort],
        rawId: model.id,
      });
    }

    families.set(familyId, family);
  }

  return [...families].map(([familyId, family]) => ({
    familyId,
    label: family.label || familyId,
    rawId: family.rawId,
    variants: family.variants.sort(
      (left, right) => AGY_EFFORT_LEVELS.indexOf(left.effort)
        - AGY_EFFORT_LEVELS.indexOf(right.effort),
    ),
  }));
}

/**
 * Accepts a family id or any concrete agy id, so a selection stored before the
 * families collapsed — `gemini-3.6-flash-low` — still finds its family.
 */
export function findAgyModelFamily(
  families: readonly AgyModelFamily[],
  selectedRawId: string,
): AgyModelFamily | null {
  const { familyId } = splitAgyModelVersion(splitAgyModelId(selectedRawId).baseId);
  return families.find((family) => family.familyId === familyId) ?? null;
}

export function resolveAgyDefaultEffort(
  family: AgyModelFamily | null,
): AgyEffortLevel | null {
  if (!family || family.variants.length === 0) return null;

  const offered = new Set(family.variants.map((variant) => variant.effort));
  return EFFORT_FALLBACK_ORDER.find((effort) => offered.has(effort))
    ?? family.variants[0].effort;
}
