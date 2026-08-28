import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  AgyEventNormalizer,
  type AgyNormalizedEvent,
} from '@/providers/agy/normalization/agyEventNormalization';
import type { AgyStreamEvent } from '@/providers/agy/runtime/agyStream';
import { parseAgyStreamLine } from '@/providers/agy/runtime/agyStream';

const FIXTURE_DIR = path.join(__dirname, '../../../fixtures/agy');

function replay(fixture: string): AgyNormalizedEvent[] {
  const raw = fs.readFileSync(path.join(FIXTURE_DIR, fixture), 'utf8');
  const normalizer = new AgyEventNormalizer({
    contextWindow: 1_000_000,
    model: 'gemini-3-pro',
  });

  return raw
    .split('\n')
    .map((line) => parseAgyStreamLine(line))
    .filter((event): event is NonNullable<typeof event> => event !== null)
    .flatMap((event) => normalizer.next(event));
}

function ofType<TType extends AgyNormalizedEvent['type']>(
  events: readonly AgyNormalizedEvent[],
  type: TType,
): Extract<AgyNormalizedEvent, { type: TType }>[] {
  return events.filter(
    (event): event is Extract<AgyNormalizedEvent, { type: TType }> => event.type === type,
  );
}

describe('AgyEventNormalizer', () => {
  describe('a completed turn that ran a command and wrote files', () => {
    const events = replay('yolo-turn.jsonl');

    it('announces the assistant exactly once', () => {
      expect(ofType(events, 'assistant_message_started')).toHaveLength(1);
    });

    it('maps agy tool names and parameter keys to Claudian identities', () => {
      const started = ofType(events, 'tool_started');

      expect(started.map((event) => event.name)).toEqual(['Bash', 'Write', 'Read', 'Edit']);
      expect(started[0].input).toEqual({ command: 'echo hi' });
      expect(started[1].input.file_path).toMatch(/d\.txt$/);
    });

    it('correlates completion to its start by step index', () => {
      const started = ofType(events, 'tool_started');
      const completed = ofType(events, 'tool_completed');

      expect(completed.map((event) => event.toolCallId))
        .toEqual(started.map((event) => event.toolCallId));
      expect(completed.every((event) => event.isError === false)).toBe(true);
    });

    it('carries captured command output on the matching tool call', () => {
      const bashStart = ofType(events, 'tool_started')
        .find((event) => event.name === 'Bash');
      const bashEnd = ofType(events, 'tool_completed')
        .find((event) => event.toolCallId === bashStart?.toolCallId);

      expect(bashEnd?.content).toBe('hi\n');
    });

    it('streams assistant text and ends the turn once', () => {
      expect(ofType(events, 'text_delta').length).toBeGreaterThan(0);

      const completions = ofType(events, 'turn_completed');
      expect(completions).toHaveLength(1);
      expect(completions[0].reason).toBe('completed');
      expect(ofType(events, 'execution_error')).toHaveLength(0);
    });

    it('reports context from the newest step, not the summed turn', () => {
      const usage = ofType(events, 'usage_updated');

      expect(usage).toHaveLength(1);
      // Last agent_response step: total 6240. Result sums every step: 20196.
      expect(usage[0].usage.contextTokens).toBe(6240);
      expect(usage[0].usage.inputTokens).toBe(5723);
      expect(usage[0].usage.contextWindowIsAuthoritative).toBe(false);
    });
  });

  describe('a turn whose write was denied because print mode cannot prompt', () => {
    const events = replay('permission-denied-turn.jsonl');

    it('marks the denied tool as an error and keeps agy\'s message', () => {
      const completed = ofType(events, 'tool_completed');

      expect(completed).toHaveLength(1);
      expect(completed[0].toolCallId)
        .toBe(ofType(events, 'tool_started')[0].toolCallId);
      expect(completed[0].isError).toBe(true);
      expect(completed[0].content).toContain('User denied permission');
    });

    it('ends the turn as a provider error instead of a silent success', () => {
      const errors = ofType(events, 'execution_error');

      expect(ofType(events, 'turn_completed')).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('User denied permission');
      expect(errors[0].recoverable).toBe(true);
    });
  });

  describe('a turn that delegated to a subagent', () => {
    const events = replay('subagent-turn.jsonl');

    it('renders the delegation as an Agent tool call', () => {
      const started = ofType(events, 'tool_started');

      expect(started).toHaveLength(1);
      expect(started[0].name).toBe('Agent');
      expect(started[0].input).toEqual({
        description: 'Directory & README Researcher',
        prompt: expect.stringContaining('list the files in this directory'),
        subagent_type: 'research',
      });
    });

    it('completes the delegation without an error', () => {
      const completed = ofType(events, 'tool_completed');

      expect(completed).toHaveLength(1);
      expect(completed[0].toolCallId).toBe(ofType(events, 'tool_started')[0].toolCallId);
      expect(completed[0].isError).toBe(false);
    });

    it('keeps the subagent findings that arrive as parent text', () => {
      const text = ofType(events, 'text_delta').map((event) => event.text).join('');

      expect(text).toContain('delegated the task to a research subagent');
      expect(text).toContain('The research subagent has completed the task');
    });

    it('emits nothing for the system_message step that precedes the findings', () => {
      const normalizer = new AgyEventNormalizer({ contextWindow: 1_000_000 });

      expect(normalizer.next({
        event: 'step_update',
        step_update: { state: 'DONE', step_index: 6, step_type: 'system_message' },
      })).toEqual([]);
    });

    it('renders one Agent call per delegated subagent', () => {
      const normalizer = new AgyEventNormalizer({ contextWindow: 1_000_000 });
      const subagents = [{ role: 'First' }, { role: 'Second' }];

      const started = normalizer.next({
        event: 'step_update',
        step_update: {
          state: 'ACTIVE',
          step_index: 3,
          step_type: 'subagent',
          subagent_info: { subagents },
          tool_name: 'invoke_subagent',
        },
      });

      expect(ofType(started, 'tool_started').map((event) => event.input.description))
        .toEqual(['First', 'Second']);
      expect(new Set(ofType(started, 'tool_started').map((event) => event.toolCallId)).size)
        .toBe(2);
    });
  });

  describe('malformed input', () => {
    it('drops unparseable and unknown lines instead of throwing', () => {
      expect(parseAgyStreamLine('')).toBeNull();
      expect(parseAgyStreamLine('not json')).toBeNull();
      expect(parseAgyStreamLine('{"event":"future_event"}')).toBeNull();
      expect(parseAgyStreamLine('{"event":"step_update"}')).toBeNull();
    });
  });
});

describe('AgyEventNormalizer usage source', () => {
  it('ignores a checkpoint step that lands after the last agent response', () => {
    const normalizer = new AgyEventNormalizer({ contextWindow: 200_000 });
    const step = (stepType: string, total: number): AgyStreamEvent => ({
      event: 'step_update',
      step_update: {
        state: 'DONE',
        step_index: total,
        step_type: stepType,
        usage: { input_tokens: total, total_tokens: total },
      },
    });

    normalizer.next(step('agent_response', 6240));
    normalizer.next(step('checkpoint', 123));
    const events = normalizer.next({
      event: 'result',
      result: { status: 'SUCCESS', usage: { total_tokens: 20196 } },
    });

    const usage = events.find((event) => event.type === 'usage_updated');
    expect(usage && usage.type === 'usage_updated' && usage.usage.contextTokens)
      .toBe(6240);
    // The window travels with the event: nothing downstream recomputes it
    // until the user changes model.
    expect(usage && usage.type === 'usage_updated' && usage.usage.contextWindow)
      .toBe(200_000);
  });
});
