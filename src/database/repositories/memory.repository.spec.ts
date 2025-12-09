import { InMemoryChatRepository } from './memory.repository';
import { ENTITY_TYPES } from '../types';

describe('InMemoryChatRepository', () => {
  let repository: InMemoryChatRepository;

  beforeEach(async () => {
    repository = new InMemoryChatRepository();
    await repository.initialize();
  });

  afterEach(async () => {
    await repository.close();
  });

  // -------------------------------------------------------------------------
  // Thread Operations
  // -------------------------------------------------------------------------

  describe('createThread', () => {
    it('should create a thread with all required fields', async () => {
      const thread = await repository.createThread({
        id: 'thread-1',
        userId: 'user-1',
        title: 'Test Thread',
        metadata: { chatType: 'simple' },
      });

      expect(thread.id).toBe('thread-1');
      expect(thread.userId).toBe('user-1');
      expect(thread.title).toBe('Test Thread');
      expect(thread.type).toBe(ENTITY_TYPES.CHAT_THREAD);
      expect(thread.isDeleted).toBe(false);
      expect(thread.isBookmarked).toBe(false);
      expect(thread._etag).toBeDefined();
      expect(thread._version).toBe(1);
      expect(thread.createdAt).toBeInstanceOf(Date);
      expect(thread.lastModifiedAt).toBeInstanceOf(Date);
    });

    it('should generate ID if not provided', async () => {
      const thread = await repository.createThread({
        id: undefined as any,
        userId: 'user-1',
        title: 'Auto ID Thread',
      });

      expect(thread.id).toBeDefined();
      expect(thread.id.length).toBeGreaterThan(0);
    });
  });

  describe('getThread', () => {
    it('should return thread by ID', async () => {
      await repository.createThread({
        id: 'thread-1',
        userId: 'user-1',
        title: 'Test Thread',
      });

      const thread = await repository.getThread('thread-1');
      expect(thread).not.toBeNull();
      expect(thread?.id).toBe('thread-1');
    });

    it('should return null for non-existent thread', async () => {
      const thread = await repository.getThread('non-existent');
      expect(thread).toBeNull();
    });

    it('should not return soft-deleted thread by default', async () => {
      await repository.createThread({
        id: 'thread-1',
        userId: 'user-1',
        title: 'Test Thread',
      });
      await repository.deleteThread('thread-1');

      const thread = await repository.getThread('thread-1');
      expect(thread).toBeNull();
    });

    it('should return soft-deleted thread when includeDeleted=true', async () => {
      await repository.createThread({
        id: 'thread-1',
        userId: 'user-1',
        title: 'Test Thread',
      });
      await repository.deleteThread('thread-1');

      const thread = await repository.getThread('thread-1', true);
      expect(thread).not.toBeNull();
      expect(thread?.isDeleted).toBe(true);
    });
  });

  describe('updateThread', () => {
    it('should update thread fields', async () => {
      const original = await repository.createThread({
        id: 'thread-1',
        userId: 'user-1',
        title: 'Original Title',
      });

      const result = await repository.updateThread('thread-1', {
        title: 'Updated Title',
        isBookmarked: true,
      });

      expect(result.success).toBe(true);
      expect(result.entity?.title).toBe('Updated Title');
      expect(result.entity?.isBookmarked).toBe(true);
      expect(result.entity?._version).toBe(2);
      expect(result.newEtag).not.toBe(original._etag);
    });

    it('should fail with ETag mismatch when retryOnConflict=false', async () => {
      await repository.createThread({
        id: 'thread-1',
        userId: 'user-1',
        title: 'Original Title',
      });

      const result = await repository.updateThread(
        'thread-1',
        { title: 'Updated Title' },
        { ifMatch: '"wrong-etag"', retryOnConflict: false },
      );

      expect(result.success).toBe(false);
      expect(result.conflict).toBe(true);
    });

    it('should fail on ETag mismatch when retry also fails', async () => {
      await repository.createThread({
        id: 'thread-1',
        userId: 'user-1',
        title: 'Original Title',
      });

      // Use wrong ETag - retry will also fail since ETag is still wrong
      // (the retry feature is meant for when another process updates the record
      // and we want to retry with the new ETag, but in this case we're passing
      // a static wrong ETag so retry will also fail)
      const result = await repository.updateThread('thread-1', { title: 'Updated Title' }, { ifMatch: '"wrong-etag"' });

      // Should still fail because the static wrong ETag doesn't match
      expect(result.success).toBe(false);
      expect(result.conflict).toBe(true);
    });

    it('should return error for non-existent thread', async () => {
      const result = await repository.updateThread('non-existent', {
        title: 'Updated',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Thread not found');
    });
  });

  describe('deleteThread (soft delete)', () => {
    it('should soft delete a thread', async () => {
      await repository.createThread({
        id: 'thread-1',
        userId: 'user-1',
        title: 'Test Thread',
      });

      const result = await repository.deleteThread('thread-1');

      expect(result.success).toBe(true);
      expect(result.newEtag).toBeDefined();

      // Should not be visible without includeDeleted
      const thread = await repository.getThread('thread-1');
      expect(thread).toBeNull();

      // Should be visible with includeDeleted
      const deletedThread = await repository.getThread('thread-1', true);
      expect(deletedThread?.isDeleted).toBe(true);
    });
  });

  describe('hardDeleteThread', () => {
    it('should permanently delete thread and its messages', async () => {
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

      const deleted = await repository.hardDeleteThread('thread-1');
      expect(deleted).toBe(true);

      // Thread should not exist even with includeDeleted
      const thread = await repository.getThread('thread-1', true);
      expect(thread).toBeNull();

      // Message should also be deleted
      const message = await repository.getMessage('msg-1', true);
      expect(message).toBeNull();
    });
  });

  describe('restoreThread', () => {
    it('should restore a soft-deleted thread', async () => {
      await repository.createThread({
        id: 'thread-1',
        userId: 'user-1',
        title: 'Test Thread',
      });

      await repository.deleteThread('thread-1');
      const result = await repository.restoreThread('thread-1');

      expect(result.success).toBe(true);
      expect(result.entity?.isDeleted).toBe(false);

      // Should be visible again
      const thread = await repository.getThread('thread-1');
      expect(thread).not.toBeNull();
    });
  });

  describe('listThreads', () => {
    beforeEach(async () => {
      // Create threads for different users
      await repository.createThread({ id: 'thread-1', userId: 'user-1', title: 'Thread 1' });
      await repository.createThread({ id: 'thread-2', userId: 'user-1', title: 'Thread 2', isBookmarked: true });
      await repository.createThread({ id: 'thread-3', userId: 'user-2', title: 'Thread 3' });
    });

    it('should filter by userId', async () => {
      const result = await repository.listThreads({ userId: 'user-1' });

      expect(result.items.length).toBe(2);
      expect(result.items.every((t) => t.userId === 'user-1')).toBe(true);
    });

    it('should filter by isBookmarked', async () => {
      const result = await repository.listThreads({
        userId: 'user-1',
        isBookmarked: true,
      });

      expect(result.items.length).toBe(1);
      expect(result.items[0].id).toBe('thread-2');
    });

    it('should exclude soft-deleted threads by default', async () => {
      await repository.deleteThread('thread-1');

      const result = await repository.listThreads({ userId: 'user-1' });
      expect(result.items.length).toBe(1);
      expect(result.items[0].id).toBe('thread-2');
    });

    it('should include soft-deleted threads when includeDeleted=true', async () => {
      await repository.deleteThread('thread-1');

      const result = await repository.listThreads({
        userId: 'user-1',
        includeDeleted: true,
      });

      expect(result.items.length).toBe(2);
    });

    it('should paginate with continuation token', async () => {
      // Create more threads
      for (let i = 4; i <= 10; i++) {
        await repository.createThread({
          id: `thread-${i}`,
          userId: 'user-1',
          title: `Thread ${i}`,
        });
      }

      const page1 = await repository.listThreads({
        userId: 'user-1',
        limit: 3,
      });

      expect(page1.items.length).toBe(3);
      expect(page1.hasMore).toBe(true);
      expect(page1.continuationToken).toBeDefined();

      const page2 = await repository.listThreads({
        userId: 'user-1',
        limit: 3,
        continuationToken: page1.continuationToken,
      });

      expect(page2.items.length).toBe(3);
      expect(page2.hasMore).toBe(true);

      // Ensure no duplicates
      const page1Ids = page1.items.map((t) => t.id);
      const page2Ids = page2.items.map((t) => t.id);
      expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false);
    });

    it('should sort by lastModifiedAt descending by default', async () => {
      // Update thread-1 to make it most recent
      await repository.updateThread('thread-1', { title: 'Updated' });

      const result = await repository.listThreads({ userId: 'user-1' });

      expect(result.items[0].id).toBe('thread-1');
    });
  });

  // -------------------------------------------------------------------------
  // Message Operations
  // -------------------------------------------------------------------------

  describe('upsertMessage', () => {
    beforeEach(async () => {
      await repository.createThread({
        id: 'thread-1',
        userId: 'user-1',
        title: 'Test Thread',
      });
    });

    it('should create a new message', async () => {
      const message = await repository.upsertMessage({
        id: 'msg-1',
        threadId: 'thread-1',
        userId: 'user-1',
        role: 'user',
        content: 'Hello, world!',
        metadata: { traceId: 'trace-1' },
      });

      expect(message.id).toBe('msg-1');
      expect(message.type).toBe(ENTITY_TYPES.CHAT_MESSAGE);
      expect(message.role).toBe('user');
      expect(message.content).toBe('Hello, world!');
      expect(message._version).toBe(1);
    });

    it('should update existing message (idempotent)', async () => {
      await repository.upsertMessage({
        id: 'msg-1',
        threadId: 'thread-1',
        userId: 'user-1',
        role: 'assistant',
        content: 'Partial response...',
      });

      const updated = await repository.upsertMessage({
        id: 'msg-1',
        threadId: 'thread-1',
        userId: 'user-1',
        role: 'assistant',
        content: 'Complete response!',
      });

      expect(updated.content).toBe('Complete response!');
      expect(updated._version).toBe(2);

      // Should still be only one message
      const count = await repository.countMessages('thread-1');
      expect(count).toBe(1);
    });

    it('should update thread lastModifiedAt', async () => {
      const threadBefore = await repository.getThread('thread-1');
      const beforeTime = threadBefore!.lastModifiedAt.getTime();

      // Wait a bit to ensure time difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      await repository.upsertMessage({
        id: 'msg-1',
        threadId: 'thread-1',
        userId: 'user-1',
        role: 'user',
        content: 'Hello',
      });

      const threadAfter = await repository.getThread('thread-1');
      expect(threadAfter!.lastModifiedAt.getTime()).toBeGreaterThan(beforeTime);
    });
  });

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

      await repository.upsertMessage({
        id: 'msg-3',
        threadId: 'thread-1',
        userId: 'user-1',
        role: 'user',
        content: 'How are you?',
      });
    });

    it('should return messages in conversation order (by createdAt)', async () => {
      const result = await repository.getMessages('thread-1');

      expect(result.items.length).toBe(3);
      expect(result.items[0].id).toBe('msg-1');
      expect(result.items[1].id).toBe('msg-2');
      expect(result.items[2].id).toBe('msg-3');
    });

    it('should filter by role', async () => {
      const result = await repository.getMessages('thread-1', { role: 'user' });

      expect(result.items.length).toBe(2);
      expect(result.items.every((m) => m.role === 'user')).toBe(true);
    });

    it('should exclude soft-deleted messages by default', async () => {
      await repository.deleteMessage('msg-2');

      const result = await repository.getMessages('thread-1');
      expect(result.items.length).toBe(2);
      expect(result.items.some((m) => m.id === 'msg-2')).toBe(false);
    });

    it('should paginate with continuation token', async () => {
      const page1 = await repository.getMessages('thread-1', { limit: 2 });

      expect(page1.items.length).toBe(2);
      expect(page1.hasMore).toBe(true);
      expect(page1.continuationToken).toBeDefined();

      const page2 = await repository.getMessages('thread-1', {
        limit: 2,
        continuationToken: page1.continuationToken,
      });

      expect(page2.items.length).toBe(1);
      expect(page2.hasMore).toBe(false);
    });
  });

  describe('getLastMessage', () => {
    it('should return the last non-deleted message', async () => {
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

      const lastMessage = await repository.getLastMessage('thread-1');
      expect(lastMessage?.id).toBe('msg-2');
    });

    it('should skip soft-deleted messages', async () => {
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
        content: 'Last (deleted)',
      });

      await repository.deleteMessage('msg-2');

      const lastMessage = await repository.getLastMessage('thread-1');
      expect(lastMessage?.id).toBe('msg-1');
    });
  });

  describe('countMessages', () => {
    it('should count non-deleted messages', async () => {
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

      await repository.deleteMessage('msg-2');

      const count = await repository.countMessages('thread-1');
      expect(count).toBe(1);

      const countWithDeleted = await repository.countMessages('thread-1', true);
      expect(countWithDeleted).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // User Isolation (Security)
  // -------------------------------------------------------------------------

  describe('User Isolation', () => {
    it('should not allow accessing threads from other users via listThreads', async () => {
      await repository.createThread({
        id: 'thread-user1',
        userId: 'user-1',
        title: 'User 1 Thread',
      });

      await repository.createThread({
        id: 'thread-user2',
        userId: 'user-2',
        title: 'User 2 Thread',
      });

      // User 1 should only see their own threads
      const user1Threads = await repository.listThreads({ userId: 'user-1' });
      expect(user1Threads.items.length).toBe(1);
      expect(user1Threads.items[0].userId).toBe('user-1');

      // User 2 should only see their own threads
      const user2Threads = await repository.listThreads({ userId: 'user-2' });
      expect(user2Threads.items.length).toBe(1);
      expect(user2Threads.items[0].userId).toBe('user-2');
    });
  });

  // -------------------------------------------------------------------------
  // Batch Operations
  // -------------------------------------------------------------------------

  describe('bulkUpsertMessages', () => {
    it('should insert multiple messages', async () => {
      await repository.createThread({
        id: 'thread-1',
        userId: 'user-1',
        title: 'Test Thread',
      });

      const messages = await repository.bulkUpsertMessages([
        { id: 'msg-1', threadId: 'thread-1', userId: 'user-1', role: 'user', content: 'One' } as any,
        { id: 'msg-2', threadId: 'thread-1', userId: 'user-1', role: 'assistant', content: 'Two' } as any,
      ]);

      expect(messages.length).toBe(2);

      const count = await repository.countMessages('thread-1');
      expect(count).toBe(2);
    });
  });

  describe('bulkDeleteMessages', () => {
    it('should soft delete all messages in a thread', async () => {
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

      const deletedCount = await repository.bulkDeleteMessages('thread-1');
      expect(deletedCount).toBe(2);

      const count = await repository.countMessages('thread-1');
      expect(count).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Cache/Version Support
  // -------------------------------------------------------------------------

  describe('getThreadVersion / incrementThreadVersion', () => {
    it('should track thread version for cache invalidation', async () => {
      await repository.createThread({
        id: 'thread-1',
        userId: 'user-1',
        title: 'Test Thread',
      });

      const v1 = await repository.getThreadVersion('thread-1');
      expect(v1).toBe(1);

      await repository.incrementThreadVersion('thread-1');

      const v2 = await repository.getThreadVersion('thread-1');
      expect(v2).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  describe('isHealthy', () => {
    it('should return true for in-memory repository', async () => {
      const healthy = await repository.isHealthy();
      expect(healthy).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return repository statistics', async () => {
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

      await repository.deleteThread('thread-1');

      const stats = repository.getStats();
      expect(stats.threadCount).toBe(0); // Soft deleted
      expect(stats.deletedThreads).toBe(1);
      expect(stats.messageCount).toBe(1);
    });
  });
});
