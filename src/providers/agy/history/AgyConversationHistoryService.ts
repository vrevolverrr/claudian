import type { ProviderConversationHistoryService } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { AGY_CONVERSATION_STATE_KEY, getAgyState } from '../types';

/**
 * agy keeps its transcript in a private conversation database this provider
 * does not read. Replay comes from the Claudian-owned message transcript the
 * conversation repository persists for providers with
 * `supportsNativeHistory: false`, so this service has nothing to hydrate. The
 * only provider-native identity worth carrying is agy's conversation id,
 * which lets a reopened conversation resume with `--conversation`.
 */
export class AgyConversationHistoryService implements ProviderConversationHistoryService {
  async hydrateConversationHistory(): Promise<void> {
    // Replay is repository-owned; see the class docs.
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
