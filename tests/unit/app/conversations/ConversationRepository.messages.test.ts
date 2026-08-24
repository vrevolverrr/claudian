import '@/providers';

import { ConversationRepository } from '@/app/conversations/ConversationRepository';
import type { ConversationPersistence } from '@/core/bootstrap/ConversationPersistenceStore';
import type { SessionMetadataReader } from '@/core/bootstrap/SessionStorage';
import type { ChatMessage, Conversation } from '@/core/types';

function createConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conversation-1',
    providerId: 'agy',
    title: 'Conversation',
    createdAt: 1,
    lastActivityAt: 1,
    sessionId: null,
    messages: [],
    ...overrides,
  };
}

function createMessages(): ChatMessage[] {
  return [
    { id: 'user-1', role: 'user', content: 'Hello', timestamp: 10 },
    { id: 'assistant-1', role: 'assistant', content: 'Hi', timestamp: 20 },
  ];
}

function createPersistence(): jest.Mocked<ConversationPersistence> {
  const metadataReader: SessionMetadataReader = {
    load: jest.fn(),
    scan: jest.fn(),
    loadMetadata: jest.fn(),
    scanMetadata: jest.fn(),
    listMetadata: jest.fn(),
  };
  return {
    metadataReader,
    loadInputLedger: jest.fn().mockResolvedValue({ status: 'missing' }),
    saveInputLedger: jest.fn().mockResolvedValue(undefined),
    saveMetadata: jest.fn().mockResolvedValue(undefined),
    deleteCurrentMetadata: jest.fn().mockResolvedValue(undefined),
    deleteLegacyMetadata: jest.fn().mockResolvedValue(undefined),
    deleteInputLedger: jest.fn().mockResolvedValue(undefined),
    isDeleted: jest.fn().mockResolvedValue(false),
    markDeleted: jest.fn().mockResolvedValue(undefined),
    loadMessages: jest.fn().mockResolvedValue(null),
    saveMessages: jest.fn().mockResolvedValue(undefined),
    deleteMessages: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<ConversationPersistence>;
}

function createRepository(conversation: Conversation) {
  const persistence = createPersistence();
  const repository = new ConversationRepository({
    getSettings: () => ({}),
    getVaultPath: () => '/vault',
    persistence,
    onConversationDeleted: jest.fn().mockResolvedValue(undefined),
  });
  repository.replaceAll([conversation]);
  return { repository, persistence };
}

describe('ConversationRepository Claudian-owned message persistence', () => {
  it('persists rendered messages for a provider without native history', async () => {
    const conversation = createConversation();
    const { repository, persistence } = createRepository(conversation);
    const messages = createMessages();

    await repository.update(conversation.id, { messages });

    expect(persistence.saveMessages).toHaveBeenCalledWith(
      conversation.id,
      messages,
    );
  });

  it('does not persist messages for a provider with native history', async () => {
    const conversation = createConversation({ providerId: 'claude' });
    const { repository, persistence } = createRepository(conversation);

    await repository.update(conversation.id, { messages: createMessages() });

    expect(persistence.saveMessages).not.toHaveBeenCalled();
  });

  it('does not overwrite the persisted transcript from an unhydrated save', async () => {
    const conversation = createConversation();
    const { repository, persistence } = createRepository(conversation);

    await repository.setPinned(conversation.id, true);

    expect(persistence.saveMessages).not.toHaveBeenCalled();
  });

  it('hydrates an empty conversation from the persisted transcript', async () => {
    const conversation = createConversation();
    const { repository, persistence } = createRepository(conversation);
    const messages = createMessages();
    persistence.loadMessages.mockResolvedValue(messages);

    const hydrated = await repository.ensureHydrated(conversation.id);

    expect(hydrated?.messages).toEqual(messages);
  });

  it('keeps in-memory messages authoritative over the persisted transcript', async () => {
    const liveMessages = createMessages();
    const conversation = createConversation({ messages: liveMessages });
    const { repository, persistence } = createRepository(conversation);
    persistence.loadMessages.mockResolvedValue([
      { id: 'stale-1', role: 'user', content: 'Stale', timestamp: 1 },
    ]);

    // Simulate post-turn state invalidation forcing a re-hydration pass.
    await repository.update(conversation.id, {
      providerState: { agyConversationId: 'agy-1' },
    });
    const hydrated = await repository.ensureHydrated(conversation.id);

    expect(hydrated?.messages).toEqual(liveMessages);
  });

  it('deletes the persisted transcript with the conversation', async () => {
    const conversation = createConversation();
    const { repository, persistence } = createRepository(conversation);

    await repository.delete(conversation.id);

    expect(persistence.deleteMessages).toHaveBeenCalledWith(conversation.id);
  });
});
