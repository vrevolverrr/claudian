/**
 * Wire types for `agy --print --output-format stream-json`.
 *
 * Verified against agy print mode: one NDJSON object per line, a single `init`
 * first, one `step_update` per step transition, and a terminal `result`.
 * Unknown `event` values and malformed lines are dropped, never thrown, so a
 * newer agy build cannot break an in-flight turn.
 */

export type AgyStepState = 'ACTIVE' | 'DONE' | 'ERROR';

export interface AgyToolError {
  readonly type?: string;
  readonly message?: string;
}

export interface AgyToolInfo {
  readonly name?: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly output?: string;
  readonly error?: AgyToolError;
}

export interface AgyUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly thinking_tokens?: number;
  readonly cache_read_tokens?: number;
  readonly total_tokens?: number;
}

export interface AgyStepUpdate {
  readonly conversation_id?: string;
  readonly step_index: number;
  readonly state: AgyStepState;
  /** Observed: user_input, agent_response, tool, checkpoint, unknown. */
  readonly step_type: string;
  readonly duration_seconds?: number;
  readonly usage?: AgyUsage;
  readonly tool_name?: string;
  readonly tool_info?: AgyToolInfo;
  readonly text_delta?: string;
}

export interface AgyInit {
  readonly cwd?: string;
  readonly tools?: readonly string[];
  /** Observed: request-review, always-proceed. Stale when --mode was passed. */
  readonly permission_mode?: string;
}

export interface AgyResult {
  readonly conversation_id?: string;
  readonly status?: string;
  readonly response?: string;
  readonly error?: string;
  readonly num_turns?: number;
  readonly usage?: AgyUsage;
}

export type AgyStreamEvent =
  | { readonly event: 'init'; readonly conversation_id?: string; readonly init: AgyInit }
  | { readonly event: 'step_update'; readonly step_update: AgyStepUpdate }
  | { readonly event: 'result'; readonly result: AgyResult };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseAgyStreamLine(line: string): AgyStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  switch (parsed.event) {
    case 'init':
      return isRecord(parsed.init)
        ? parsed as unknown as Extract<AgyStreamEvent, { event: 'init' }>
        : null;
    case 'step_update':
      return isRecord(parsed.step_update) && typeof parsed.step_update.step_index === 'number'
        ? parsed as unknown as Extract<AgyStreamEvent, { event: 'step_update' }>
        : null;
    case 'result':
      return isRecord(parsed.result)
        ? parsed as unknown as Extract<AgyStreamEvent, { event: 'result' }>
        : null;
    default:
      return null;
  }
}
