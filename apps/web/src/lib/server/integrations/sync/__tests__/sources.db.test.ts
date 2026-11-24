import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  eq,
  user,
  principal,
  boards,
  posts,
  postComments,
  conversations,
  conversationMessages,
  integrations,
  integrationEventMappings,
  integrationSyncOperations as operations,
} from '@/lib/server/db'
import { encryptSecrets } from '../../encryption'
import { queueHookSync } from '../hooks'
import { runIntegrationSync } from '../worker'
import { syncTestJob } from './job'
import type { MessageCreatedEvent, EventData } from '@/lib/server/events/types'
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/secret-key', () => ({
  activeSecretKey: () => 'integration-sync-test-key-32-characters-only',
}))
const deliver = vi.hoisted(() => vi.fn().mockResolvedValue({ state: 'succeeded' }))
vi.mock('@/integrations/slack/server/hook', () => ({ slackHook: { run: deliver } }))
vi.mock('@/integrations/discord/server/hook', () => ({ discordHook: { run: deliver } }))
vi.mock('@/integrations/discord/server/channels', async (original) => ({
  ...(await original<typeof import('@/integrations/discord/server/channels')>()),
  validateDiscordDestination: async () => true,
}))
const fixture = await createDbTestFixture()
beforeEach(fixture.begin)
afterEach(async () => {
  vi.clearAllMocks()
  await fixture.rollback()
})
afterAll(fixture.close)
async function seed() {
  const [person] = await testDb
    .insert(user)
    .values({ name: 'Current person', email: `${createId('user')}@example.com` })
    .returning()
  const [author] = await testDb
    .insert(principal)
    .values({
      userId: person.id,
      type: 'user',
      role: 'user',
      displayName: 'Current person',
      createdAt: new Date(),
    })
    .returning()
  const [conversation] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: author.id, channel: 'messenger', subject: 'Support request' })
    .returning()
  const [message] = await testDb
    .insert(conversationMessages)
    .values({
      conversationId: conversation.id,
      principalId: author.id,
      senderType: 'visitor',
      content: 'Canonical message',
    })
    .returning()
  const [integration] = await testDb
    .insert(integrations)
    .values({
      integrationType: 'slack',
      status: 'active',
      secrets: encryptSecrets({ accessToken: 'current-token' }),
      config: { channelId: 'C1' },
    })
    .returning()
  await testDb.insert(integrationEventMappings).values({
    integrationId: integration.id,
    eventType: 'message.created',
    actionType: 'send_message',
    enabled: true,
    actionConfig: { channelId: 'C1' },
  })
  const event: MessageCreatedEvent = {
    id: createId('event'),
    type: 'message.created',
    timestamp: new Date().toISOString(),
    actor: { type: 'user', principalId: author.id, email: 'old-private@example.com' },
    data: {
      isFirstMessage: true,
      conversation: { id: conversation.id, status: 'open', channel: 'messenger', priority: 'none' },
      message: {
        id: message.id,
        conversationId: conversation.id,
        senderType: 'visitor',
        authorPrincipalId: author.id,
        authorName: 'Old name',
        authorEmail: 'old-private@example.com',
        content: 'Old content',
        createdAt: new Date().toISOString(),
      },
    },
  }
  const data = {
    hookType: 'slack',
    event,
    target: { channelId: 'C1' },
    config: { integrationId: integration.id, accessToken: 'expired-token' },
  }
  return { message, conversation, integration, data, person, author }
}
describe('canonical sync sources (PostgreSQL)', () => {
  it.each(['post.created', 'comment.created', 'comment.updated'] as const)(
    '%s refreshes the source author independently of the event actor',
    async (type) => {
      const { data, person, author } = await seed()
      const [board] = await testDb
        .insert(boards)
        .values({ name: 'Authors', slug: createId('board') })
        .returning()
      const [postAuthor] = await testDb
        .insert(principal)
        .values({
          type: 'service',
          role: 'user',
          displayName: 'Post author',
          createdAt: new Date(),
        })
        .returning()
      const [post] = await testDb
        .insert(posts)
        .values({
          boardId: board.id,
          principalId: postAuthor.id,
          title: 'Current post',
          content: 'Current body',
        })
        .returning()
      const [comment] = await testDb
        .insert(postComments)
        .values({
          postId: post.id,
          principalId: author.id,
          content: 'Current comment',
        })
        .returning()
      await testDb.insert(integrationEventMappings).values({
        integrationId: data.config.integrationId,
        eventType: type,
        actionType: 'send_message',
        enabled: true,
        actionConfig: { channelId: 'C1' },
      })
      const event = {
        id: createId('event'),
        type,
        timestamp: new Date().toISOString(),
        actor: { type: 'service' },
        data: {
          post: {
            id: post.id,
            title: 'Old title',
            content: 'Old body',
            boardId: board.id,
            boardSlug: board.slug,
            voteCount: 0,
            authorName: 'Stale post author',
            authorEmail: 'stale@example.com',
          },
          ...(type === 'post.created'
            ? {}
            : {
                comment: {
                  id: comment.id,
                  content: 'Old comment',
                  authorName: 'Stale commenter',
                  authorEmail: 'stale@example.com',
                },
              }),
        },
      } as EventData
      const op = (await queueHookSync({ ...data, event }))!
      await runIntegrationSync(syncTestJob(op.id))
      expect(deliver).toHaveBeenCalledTimes(1)
      const sent = deliver.mock.calls[0][0]
      expect(sent.data.post).toMatchObject({ authorName: 'Post author', authorEmail: undefined })
      if (type !== 'post.created')
        expect(sent.data.comment).toMatchObject({
          authorName: 'Current person',
          authorEmail: person.email,
          content: 'Current comment',
        })
      expect(JSON.stringify(sent)).not.toMatch(/Stale|stale@example|Old comment|Old body/)
    }
  )
  it('preserves support-message notifications using current content, identity and credentials', async () => {
    const { data, person } = await seed()
    const op = await queueHookSync(data)
    if (!op) throw new Error('Expected a new sync operation')
    expect(op.state).toBe('queued')
    await runIntegrationSync(syncTestJob(op.id))
    expect(deliver).toHaveBeenCalledTimes(1)
    const [event, target, config] = deliver.mock.calls[0]
    expect(event.data.message).toMatchObject({
      content: 'Canonical message',
      authorName: 'Current person',
      authorEmail: person.email,
    })
    expect(event.actor.email).toBe(person.email)
    expect(target).toEqual({ channelId: 'C1' })
    expect(config.accessToken).toBe('current-token')
    expect(JSON.stringify(deliver.mock.calls)).not.toMatch(/old-private|Old content|expired-token/)
  })
  it('delivers a support message on a channel whose board filter only governs feedback', async () => {
    const { data } = await seed()
    // Saving a channel's board filter writes it onto every mapping of that channel.
    await testDb
      .update(integrationEventMappings)
      .set({ filters: { boardIds: [createId('board')] } })
      .where(eq(integrationEventMappings.integrationId, data.config.integrationId))
    const op = (await queueHookSync(data))!
    await runIntegrationSync(syncTestJob(op.id))
    expect(deliver).toHaveBeenCalledTimes(1)
  })
  it('still holds back a post from a board outside the channel filter', async () => {
    const { data, author } = await seed()
    const [ideas, bugs] = await testDb
      .insert(boards)
      .values([
        { name: 'Ideas', slug: createId('board') },
        { name: 'Bugs', slug: createId('board') },
      ])
      .returning()
    const [post] = await testDb
      .insert(posts)
      .values({ boardId: bugs.id, principalId: author.id, title: 'Crash', content: 'Body' })
      .returning()
    await testDb.insert(integrationEventMappings).values({
      integrationId: data.config.integrationId,
      eventType: 'post.created',
      actionType: 'send_message',
      enabled: true,
      actionConfig: { channelId: 'C1' },
      filters: { boardIds: [ideas.id] },
    })
    const event = {
      id: createId('event'),
      type: 'post.created',
      timestamp: new Date().toISOString(),
      actor: { type: 'service' },
      data: {
        post: {
          id: post.id,
          title: 'Crash',
          content: 'Body',
          boardId: bugs.id,
          boardSlug: bugs.slug,
          voteCount: 0,
        },
      },
    } as EventData
    const op = await queueHookSync({ ...data, event })
    if (op) await runIntegrationSync(syncTestJob(op.id))
    expect(deliver).not.toHaveBeenCalled()
  })
  it('delivers a support message to Discord', async () => {
    const { data, integration } = await seed()
    await testDb
      .update(integrations)
      .set({ integrationType: 'discord', config: { guildId: 'g1', channelId: 'C1' } })
      .where(eq(integrations.id, integration.id))
    const op = (await queueHookSync({ ...data, hookType: 'discord' }))!
    await runIntegrationSync(syncTestJob(op.id))
    expect(deliver).toHaveBeenCalledTimes(1)
    expect(deliver.mock.calls[0][0].data.message).toMatchObject({ content: 'Canonical message' })
  })
  it('purges a message snapshot and cancels delivery when it becomes internal', async () => {
    const { data, message } = await seed()
    const op = await queueHookSync(data)
    if (!op) throw new Error('Expected a new sync operation')
    await testDb
      .update(conversationMessages)
      .set({ isInternal: true })
      .where(eq(conversationMessages.id, message.id))
    const stored = await testDb.query.integrationSyncOperations.findFirst({
      where: eq(operations.id, op.id),
    })
    expect(stored).toMatchObject({ state: 'cancelled', payload: null })
    await runIntegrationSync(syncTestJob(op.id))
    expect(deliver).not.toHaveBeenCalled()
  })
  it('does not capture an already-internal source snapshot', async () => {
    const { data, message } = await seed()
    await testDb
      .update(conversationMessages)
      .set({ isInternal: true })
      .where(eq(conversationMessages.id, message.id))
    const op = await queueHookSync(data)
    if (!op) throw new Error('Expected a new sync operation')
    expect(
      await testDb.query.integrationSyncOperations.findFirst({ where: eq(operations.id, op.id) })
    ).toMatchObject({ state: 'cancelled', payload: null })
  })
})
