import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  eq,
  user,
  principal,
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
import type { MessageCreatedEvent } from '@/lib/server/events/types'
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/secret-key', () => ({
  activeSecretKey: () => 'integration-sync-test-key-32-characters-only',
}))
const deliver = vi.hoisted(() => vi.fn().mockResolvedValue({ state: 'succeeded' }))
vi.mock('@/integrations/slack/server/hook', () => ({ slackHook: { run: deliver } }))
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
  return { message, conversation, integration, data, person }
}
describe('canonical sync sources (PostgreSQL)', () => {
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
