import { ChatService } from './chat.service';
import { AgentFactory } from '../agents/agent.factory';
import { InMemoryChatRepository } from '../database/repositories/memory.repository';

describe('ChatService', () => {
  let service: ChatService;
  let repository: InMemoryChatRepository;

  // Mock agent for testing
  const mockAgent = {
    run: jest.fn().mockImplementation(async function* () {
      yield { event: 'data', data: { answer: 'Hello, ' } };
      yield { event: 'data', data: { answer: 'world!' } };
      yield { event: 'done', data: {} };
    }),
  };

  const mockAgentFactory = {
    getAgent: jest.fn().mockReturnValue(mockAgent),
  } as unknown as AgentFactory;

  beforeEach(async () => {
    repository = new InMemoryChatRepository();
    await repository.initialize();
    service = new ChatService(mockAgentFactory, repository);
  });

  afterEach(async () => {
    await repository.close();
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Thread Operations
  // -------------------------------------------------------------------------

  describe('getThread', () => {
    it('should return thread by ID', async () => {
      await repository.createThread({
        id: 'thread-1',
        userId: 'user-1',
        title: 'Test Thread',
      });

      const thread = await service.getThread('thread-1');
      expect(thread).not.toBeNull();
      expect(thread?.id).toBe('thread-1');
    });

    it('should return null for non-existent thread', async () => {
      const thread = await service.getThread('non-existent');
      expect(thread).toBeNull();
    });
  });

  describe('listThreads', () => {
    beforeEach(async () => {
      await repository.createThread({ id: 'thread-1', userId: 'user-1', title: 'Thread 1' });
      await repository.createThread({ id: 'thread-2', userId: 'user-1', title: 'Thread 2' });
      await repository.createThread({ id: 'thread-3', userId: 'user-2', title: 'Thread 3' });
    });

    it('should list threads for a specific user only', async () => {
      const result = await service.listThreads({ userId: 'user-1' });

      expect(result.items.length).toBe(2);
      expect(result.items.every((t) => t.userId === 'user-1')).toBe(true);
    });

    it('should respect pagination limits', async () => {
      const result = await service.listThreads({ userId: 'user-1', limit: 1 });

      expect(result.items.length).toBe(1);
      expect(result.hasMore).toBe(true);
      expect(result.continuationToken).toBeDefined();
    });
  });

  describe('updateThread', () => {
    it('should update thread with ETag validation', async () => {
      const thread = await repository.createThread({
        id: 'thread-1',
        userId: 'user-1',
        title: 'Original',
      });

      const result = await service.updateThread('thread-1', { title: 'Updated' }, thread._etag);

      expect(result.success).toBe(true);
      expect(result.entity?.title).toBe('Updated');
    });

    it('should succeed without ETag', async () => {
      await repository.createThread({
        id: 'thread-1',
        userId: 'user-1',
        title: 'Original',
      });

      const result = await service.updateThread('thread-1', { title: 'Updated' });
      expect(result.success).toBe(true);
    });
  });

  describe('deleteThread', () => {
    it('should soft delete thread', async () => {
      await repository.createThread({
        id: 'thread-1',
        userId: 'user-1',
        title: 'Test Thread',
      });

      const result = await service.deleteThread('thread-1');

      expect(result.success).toBe(true);

      // Thread should not be visible
      const thread = await service.getThread('thread-1');
      expect(thread).toBeNull();
    });
  });

  describe('restoreThread', () => {
    it('should restore soft-deleted thread', async () => {
      await repository.createThread({
        id: 'thread-1',
        userId: 'user-1',
        title: 'Test Thread',
      });

      await service.deleteThread('thread-1');
      const result = await service.restoreThread('thread-1');

      expect(result.success).toBe(true);
      expect(result.entity?.isDeleted).toBe(false);
    });
  });

  describe('hardDeleteThread', () => {
    it('should permanently delete thread', async () => {
      await repository.createThread({
        id: 'thread-1',
        userId: 'user-1',
        title: 'Test Thread',
      });

      const deleted = await service.hardDeleteThread('thread-1');

      expect(deleted).toBe(true);

      // Thread should not exist even with includeDeleted
      const thread = await service.getThread('thread-1', true);
      expect(thread).toBeNull();
    });
  });

  describe('toggleBookmark', () => {
    it('should toggle bookmark status', async () => {
      await repository.createThread({
        id: 'thread-1',
        userId: 'user-1',
        title: 'Test Thread',
        isBookmarked: false,
      });

      const result1 = await service.toggleBookmark('thread-1');
      expect(result1.success).toBe(true);
      expect(result1.entity?.isBookmarked).toBe(true);

      const result2 = await service.toggleBookmark('thread-1');
      expect(result2.success).toBe(true);
      expect(result2.entity?.isBookmarked).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Message Operations
  // -------------------------------------------------------------------------

  describe('getMessages', () => {
    beforeEach(async () => {
      await repository.createThread({
        id: 'thread-1',
        userId: 'user-1',
        title: 'Test Thread',
      });

      await repository.upsertMessage({
        id: 'msg-1',
        threadId: 'thread-1',
        userId: 'user-1',
        role: 'user',
        content: 'Hello',
      });

      await repository.upsertMessage({
        id: 'msg-2',
        threadId: 'thread-1',
        userId: 'user-1',
        role: 'assistant',
        content: 'Hi there!',
      });
    });

    it('should return messages with pagination', async () => {
      const result = await service.getMessages('thread-1');

      expect(result.items.length).toBe(2);
      expect(result.items[0].role).toBe('user');
      expect(result.items[1].role).toBe('assistant');
    });

    it('should filter by role', async () => {
      const result = await service.getMessages('thread-1', { role: 'user' });

      expect(result.items.length).toBe(1);
      expect(result.items[0].role).toBe('user');
    });
  });

  describe('getMessage', () => {
    it('should return single message', async () => {
      await repository.createThread({
        id: 'thread-1',
        userId: 'user-1',
        title: 'Test Thread',
      });

      await repository.upsertMessage({
        id: 'msg-1',
        threadId: 'thread-1',
        userId: 'user-1',
        role: 'user',
        content: 'Hello',
      });

      const message = await service.getMessage('msg-1');
      expect(message).not.toBeNull();
      expect(message?.content).toBe('Hello');
    });
  });

  describe('getLastMessage', () => {
    it('should return the last message', async () => {
      await repository.createThread({
        id: 'thread-1',
        userId: 'user-1',
        title: 'Test Thread',
      });

      await repository.upsertMessage({
        id: 'msg-1',
        threadId: 'thread-1',
        userId: 'user-1',
        role: 'user',
        content: 'First',
      });

      await repository.upsertMessage({
        id: 'msg-2',
        threadId: 'thread-1',
        userId: 'user-1',
        role: 'assistant',
        content: 'Last',
      });

      const lastMessage = await service.getLastMessage('thread-1');
      expect(lastMessage?.content).toBe('Last');
    });
  });

  describe('countMessages', () => {
    it('should count messages in thread', async () => {
      await repository.createThread({
        id: 'thread-1',
        userId: 'user-1',
        title: 'Test Thread',
      });

      await repository.upsertMessage({
        id: 'msg-1',
        threadId: 'thread-1',
        userId: 'user-1',
        role: 'user',
        content: 'One',
      });

      await repository.upsertMessage({
        id: 'msg-2',
        threadId: 'thread-1',
        userId: 'user-1',
        role: 'assistant',
        content: 'Two',
      });

      const count = await service.countMessages('thread-1');
      expect(count).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Persistence Status
  // -------------------------------------------------------------------------

  describe('isPersistenceEnabled', () => {
    it('should return true when repository is configured', () => {
      expect(service.isPersistenceEnabled()).toBe(true);
    });

    it('should return false when no repository is configured', () => {
      const serviceWithoutRepo = new ChatService(mockAgentFactory);
      expect(serviceWithoutRepo.isPersistenceEnabled()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Process Chat (Streaming)
  // -------------------------------------------------------------------------

  describe('processChat', () => {
    it('should stream responses and persist messages', async () => {
      const events: any[] = [];

      for await (const event of service.processChat({
        threadId: 'new-thread',
        userId: 'user-1',
        messages: [{ id: 'msg-1', role: 'user', content: 'Hello' }],
      })) {
        events.push(event);
      }

      // Should have received streaming events
      expect(events.length).toBeGreaterThan(0);

      // Should have created thread
      const thread = await service.getThread('new-thread');
      expect(thread).not.toBeNull();

      // Should have persisted messages
      const messages = await service.getMessages('new-thread');
      expect(messages.items.length).toBe(2); // user + assistant
    });

    it('should abort when signal is triggered', async () => {
      const abortController = new AbortController();
      const events: any[] = [];

      // Create a slow mock agent
      const slowMockAgent = {
        run: jest.fn().mockImplementation(async function* () {
          yield { event: 'data', data: { answer: 'Hello, ' } };
          abortController.abort(); // Abort during streaming
          yield { event: 'data', data: { answer: 'world!' } };
          yield { event: 'done', data: {} };
        }),
      };

      (mockAgentFactory.getAgent as jest.Mock).mockReturnValueOnce(slowMockAgent);

      for await (const event of service.processChat(
        {
          threadId: 'abort-thread',
          userId: 'user-1',
          messages: [{ id: 'msg-1', role: 'user', content: 'Hello' }],
        },
        abortController.signal,
      )) {
        events.push(event);
      }

      // Should have stopped before all events
      expect(events.length).toBeLessThan(3);
    });
  });
});
