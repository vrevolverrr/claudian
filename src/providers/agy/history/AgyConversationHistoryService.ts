import type { ProviderConversationHistoryService } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { AGY_CONVERSATION_STATE_KEY, getAgyState } from '../types';

/**
 * agy keeps its transcript in a private conversation database this provider
 * does not read, so hydration is Claudian's own persisted messages. The only
 * provider-native identity worth carrying is agy's conversation id, which lets
 * a reopened conversation resume with `--conversation`.
 */
export class AgyConversationHistoryService implements ProviderConversationHistoryService {
  async hydrateConversationHistory(): Promise<void> {
    // Nothing to hydrate: Claudian already persists every message it rendered.
  }

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    if (!conversation) return null;
    return conversation.sessionId ?? getAgyState(conversation.providerState).conversationId;
  }

  isPendingForkConversation(): boolean {
    return false;
  }

  buildForkProviderState(sourceSessionId: string): Record<string, unknown> {
    // Forking cannot branch agy's own conversation, so the fork continues from
    // the same agy conversation rather than a copy of it.
    return { [AGY_CONVERSATION_STATE_KEY]: sourceSessionId };
  }
}
