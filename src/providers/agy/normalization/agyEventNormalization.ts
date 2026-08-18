import type {
  ProviderAssistantMessageStartedEvent,
  ProviderExecutionErrorEvent,
  ProviderTextDeltaEvent,
  ProviderToolCompletedEvent,
  ProviderToolStartedEvent,
  ProviderTurnCompletedEvent,
  ProviderUsageUpdatedEvent,
} from '../../../core/execution';
import type { AgyStepUpdate, AgyStreamEvent, AgyUsage } from '../runtime/agyStream';
import { buildAgyUsageInfo } from '../runtime/buildAgyUsageInfo';
import { normalizeAgyToolInput, normalizeAgyToolName } from './agyToolNormalization';

/**
 * Correlation envelopes are owned by the session, which knows the execution and
 * turn identity. The normalizer stays pure over the wire stream and emits
 * scopeless events in stream order.
 */
type Scopeless<TEvent> = Omit<TEvent, 'scope'>;

export type AgyNormalizedEvent =
  | Scopeless<ProviderAssistantMessageStartedEvent>
  | Scopeless<ProviderTextDeltaEvent>
  | Scopeless<ProviderToolStartedEvent>
  | Scopeless<ProviderToolCompletedEvent>
  | Scopeless<ProviderUsageUpdatedEvent>
  | Scopeless<ProviderTurnCompletedEvent>
  | Scopeless<ProviderExecutionErrorEvent>;

export interface AgyNormalizerOptions {
  readonly model?: string | null;
  readonly contextWindow: number;
}

/**
 * Translates one agy print-mode turn into Claudian execution events.
 *
 * State is per turn: an assistant message is announced once before the first
 * text delta, and tool completion is correlated to its start by step index.
 * agy reuses step indices only within a conversation, and one normalizer
 * instance serves one turn, so the index is a sufficient tool-call identity.
 */
export class AgyEventNormalizer {
  private assistantAnnounced = false;
  private conversationId: string | null = null;
  private latestStepUsage: AgyUsage | null = null;
  private readonly startedToolNames = new Map<number, string>();

  constructor(private readonly options: AgyNormalizerOptions) {}

  getConversationId(): string | null {
    return this.conversationId;
  }

  next(event: AgyStreamEvent): AgyNormalizedEvent[] {
    switch (event.event) {
      case 'init':
        this.conversationId = event.conversation_id ?? this.conversationId;
        return [];
      case 'step_update':
        return this.normalizeStep(event.step_update);
      case 'result':
        return this.normalizeResult(event);
    }
  }

  private normalizeStep(step: AgyStepUpdate): AgyNormalizedEvent[] {
    this.conversationId = step.conversation_id ?? this.conversationId;
    // Step usage describes the context at that step; the terminal result sums
    // every step instead, which overstates context by the length of the turn.
    // Only agent_response steps measure the conversation: a checkpoint step is
    // a small side-call whose totals would collapse the meter.
    if (step.step_type === 'agent_response' && step.usage) {
      this.latestStepUsage = step.usage;
    }

    if (step.step_type === 'tool') {
      return this.normalizeToolStep(step);
    }

    if (step.step_type === 'agent_response' && typeof step.text_delta === 'string'
      && step.text_delta.length > 0) {
      const events: AgyNormalizedEvent[] = [];
      if (!this.assistantAnnounced) {
        this.assistantAnnounced = true;
        events.push({ type: 'assistant_message_started' });
      }
      events.push({ type: 'text_delta', text: step.text_delta });
      return events;
    }

    // user_input is already rendered locally; checkpoint and unknown steps
    // carry no user-visible content.
    return [];
  }

  private normalizeToolStep(step: AgyStepUpdate): AgyNormalizedEvent[] {
    const agyToolName = step.tool_name
      ?? step.tool_info?.name
      ?? this.startedToolNames.get(step.step_index);
    if (!agyToolName) return [];

    const toolCallId = `agy-step-${step.step_index}`;

    if (step.state === 'ACTIVE') {
      this.startedToolNames.set(step.step_index, agyToolName);
      return [{
        input: normalizeAgyToolInput(agyToolName, step.tool_info?.parameters),
        name: normalizeAgyToolName(agyToolName),
        toolCallId,
        toolScope: { kind: 'main' },
        type: 'tool_started',
      }];
    }

    this.startedToolNames.delete(step.step_index);
    const isError = step.state === 'ERROR' || step.tool_info?.error !== undefined;
    const content = isError
      ? step.tool_info?.error?.message ?? 'agy reported a tool error.'
      : step.tool_info?.output;

    return [{
      ...(content === undefined ? {} : { content }),
      isError,
      toolCallId,
      toolScope: { kind: 'main' },
      type: 'tool_completed',
    }];
  }

  private normalizeResult(
    event: Extract<AgyStreamEvent, { event: 'result' }>,
  ): AgyNormalizedEvent[] {
    const { result } = event;
    this.conversationId = result.conversation_id || this.conversationId;

    const events: AgyNormalizedEvent[] = [];
    const usage = buildAgyUsageInfo(
      this.latestStepUsage ?? result.usage,
      this.options.model ?? null,
      this.options.contextWindow,
    );
    if (usage) {
      events.push({ type: 'usage_updated', usage });
    }

    if (result.status === 'SUCCESS') {
      // agy can complete an agent_response step without ever emitting a delta.
      // The result then holds the only copy of the answer.
      if (!this.assistantAnnounced && result.response) {
        this.assistantAnnounced = true;
        events.unshift(
          { type: 'assistant_message_started' },
          { text: result.response, type: 'text_delta' },
        );
      }
      events.push({ reason: 'completed', type: 'turn_completed' });
      return events;
    }

    events.push({
      category: 'provider',
      message: result.error || 'agy ended the turn without a result.',
      recoverable: true,
      type: 'execution_error',
    });
    return events;
  }
}
