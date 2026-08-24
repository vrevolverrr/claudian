import {
  CONVERSATION_MESSAGES_SCHEMA_VERSION,
  ConversationMessageStorage,
} from '@/core/bootstrap/ConversationMessageStorage';
import { MESSAGES_SUFFIX, SESSIONS_PATH } from '@/core/bootstrap/storagePaths';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import type { ChatMessage } from '@/core/types';

function createAdapter(): jest.Mocked<VaultFileAdapter> {
  return {
    delete: jest.fn().mockResolvedValue(undefined),
    exists: jest.fn().mockResolvedValue(false),
    read: jest.fn(),
    write: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<VaultFileAdapter>;
}

function createMessages(): ChatMessage[] {
  return [
    { id: 'user-1', role: 'user', content: 'Hello', timestamp: 10 },
    {
      id: 'assistant-1',
      role: 'assistant',
      content: 'Hi there',
      timestamp: 20,
      toolCalls: [],
    },
  ];
}

describe('ConversationMessageStorage', () => {
  it('round-trips messages through a schema-versioned envelope', async () => {
    const adapter = createAdapter();
    const storage = new ConversationMessageStorage(adapter);
    const messages = createMessages();

    await storage.save('conversation-1', messages);

    const [path, payload] = adapter.write.mock.calls[0] as [string, string];
    expect(path).toBe(`${SESSIONS_PATH}/conversation-1${MESSAGES_SUFFIX}`);
    expect(JSON.parse(payload)).toMatchObject({
      schemaVersion: CONVERSATION_MESSAGES_SCHEMA_VERSION,
      conversationId: 'conversation-1',
    });

    adapter.exists.mockResolvedValue(true);
    adapter.read.mockResolvedValue(payload);
    await expect(storage.load('conversation-1')).resolves.toEqual(messages);
  });

  it('returns null when the file is missing', async () => {
    const storage = new ConversationMessageStorage(createAdapter());
    await expect(storage.load('conversation-1')).resolves.toBeNull();
  });

  it('fails closed on malformed content, wrong versions, and invalid entries', async () => {
    const adapter = createAdapter();
    const storage = new ConversationMessageStorage(adapter);
    adapter.exists.mockResolvedValue(true);

    adapter.read.mockResolvedValue('{not json');
    await expect(storage.load('conversation-1')).resolves.toBeNull();

    adapter.read.mockResolvedValue(JSON.stringify({
      schemaVersion: CONVERSATION_MESSAGES_SCHEMA_VERSION + 1,
      conversationId: 'conversation-1',
      messages: createMessages(),
    }));
    await expect(storage.load('conversation-1')).resolves.toBeNull();

    adapter.read.mockResolvedValue(JSON.stringify({
      schemaVersion: CONVERSATION_MESSAGES_SCHEMA_VERSION,
      conversationId: 'conversation-1',
      messages: [{ id: 'user-1', role: 'system', content: 'x', timestamp: 1 }],
    }));
    await expect(storage.load('conversation-1')).resolves.toBeNull();
  });

  it('deletes the persisted file when present', async () => {
    const adapter = createAdapter();
    const storage = new ConversationMessageStorage(adapter);
    adapter.exists.mockResolvedValue(true);

    await storage.delete('conversation-1');

    expect(adapter.delete).toHaveBeenCalledWith(
      `${SESSIONS_PATH}/conversation-1${MESSAGES_SUFFIX}`,
    );
  });

  it('rejects unsafe conversation ids', async () => {
    const storage = new ConversationMessageStorage(createAdapter());
    await expect(storage.save('../escape', [])).rejects.toThrow(
      'Invalid session metadata id',
    );
  });
});
