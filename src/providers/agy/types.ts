/** Key under which a conversation remembers agy's own conversation identity. */
export const AGY_CONVERSATION_STATE_KEY = 'agyConversationId';

export interface AgyConversationState {
  readonly conversationId: string | null;
}

export function getAgyState(providerState: unknown): AgyConversationState {
  if (!providerState || typeof providerState !== 'object' || Array.isArray(providerState)) {
    return { conversationId: null };
  }

  const value = (providerState as Record<string, unknown>)[AGY_CONVERSATION_STATE_KEY];
  return { conversationId: typeof value === 'string' && value ? value : null };
}
