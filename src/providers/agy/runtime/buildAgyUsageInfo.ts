import type { UsageInfo } from '../../../core/types';
import type { AgyUsage } from './agyStream';

const FALLBACK_CONTEXT_WINDOW = 1_000_000;

/**
 * agy reports per-step token counts and no context window, so the window is a
 * local heuristic and is never marked authoritative.
 */
export function buildAgyUsageInfo(
  usage: AgyUsage | undefined,
  model: string | null,
  contextWindow = FALLBACK_CONTEXT_WINDOW,
): UsageInfo | null {
  if (!usage) return null;

  const inputTokens = finite(usage.input_tokens);
  const cacheReadInputTokens = finite(usage.cache_read_tokens);
  const contextTokens = finite(usage.total_tokens) || inputTokens + finite(usage.output_tokens);

  if (contextTokens === 0 && inputTokens === 0) return null;

  return {
    cacheCreationInputTokens: 0,
    cacheReadInputTokens,
    contextTokens,
    contextWindow,
    contextWindowIsAuthoritative: false,
    inputTokens,
    ...(model ? { model } : {}),
    percentage: contextWindow > 0
      ? Math.min(100, Math.max(0, Math.round((contextTokens / contextWindow) * 100)))
      : 0,
  };
}

function finite(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
