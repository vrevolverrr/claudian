import type { VaultFileAdapter } from '../storage/VaultFileAdapter';
import type { ChatMessage } from '../types';
import { assertValidSessionMetadataId } from './SessionStorage';
import { MESSAGES_SUFFIX, SESSIONS_PATH } from './storagePaths';

export const CONVERSATION_MESSAGES_SCHEMA_VERSION = 1 as const;

export interface ConversationMessagesPersistence {
  load(conversationId: string): Promise<ChatMessage[] | null>;
  save(conversationId: string, messages: readonly ChatMessage[]): Promise<void>;
  delete(conversationId: string): Promise<void>;
}

/**
 * Claudian-owned rendered transcript, persisted beside the session metadata
 * for providers whose native history cannot be replayed
 * (capabilities.supportsNativeHistory === false). The rendered messages are
 * the only durable record for those providers, so reads fail closed: any
 * malformed or unrecognized content hydrates as "no transcript" rather than
 * as partially decoded messages.
 */
export class ConversationMessageStorage implements ConversationMessagesPersistence {
  constructor(private readonly adapter: VaultFileAdapter) {}

  getPath(conversationId: string): string {
    assertValidSessionMetadataId(conversationId);
    return `${SESSIONS_PATH}/${conversationId}${MESSAGES_SUFFIX}`;
  }

  async load(conversationId: string): Promise<ChatMessage[] | null> {
    const path = this.getPath(conversationId);
    if (!(await this.adapter.exists(path))) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await this.adapter.read(path));
    } catch {
      return null;
    }
    if (
      !isRecord(parsed)
      || parsed.schemaVersion !== CONVERSATION_MESSAGES_SCHEMA_VERSION
      || parsed.conversationId !== conversationId
      || !Array.isArray(parsed.messages)
      || !parsed.messages.every(isPersistedChatMessage)
    ) {
      return null;
    }
    return parsed.messages;
  }

  async save(
    conversationId: string,
    messages: readonly ChatMessage[],
  ): Promise<void> {
    await this.adapter.write(
      this.getPath(conversationId),
      JSON.stringify({
        schemaVersion: CONVERSATION_MESSAGES_SCHEMA_VERSION,
        conversationId,
        messages,
      }),
    );
  }

  async delete(conversationId: string): Promise<void> {
    const path = this.getPath(conversationId);
    if (await this.adapter.exists(path)) {
      await this.adapter.delete(path);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPersistedChatMessage(value: unknown): value is ChatMessage {
  return isRecord(value)
    && typeof value.id === 'string'
    && (value.role === 'user' || value.role === 'assistant')
    && typeof value.content === 'string'
    && typeof value.timestamp === 'number';
}
