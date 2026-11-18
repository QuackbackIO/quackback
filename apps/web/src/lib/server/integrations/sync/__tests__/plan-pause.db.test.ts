/**
 * Integration sync pauses after the plan limits grace on a plan without
 * integrations. A queued operation is claimed and settled as cancelled with
 * its own reason, so it is neither sent nor replayed later. The connection
 * and its tokens are left as they are.
 */
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
import {
  FEATURE_STATES,
  runsWithoutPlanGate,
  setFeatureState,
} from '@/lib/server/domains/plan-limits/__tests__/feature-states'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/secret-key', () => ({
  activeSecretKey: () => 'integration-sync-test-key-32-characters-only',
}))
const deliver = vi.hoisted(() => vi.fn().mockResolvedValue({ state: 'succeeded' }))
vi.mock('@/integrations/slack/server/hook', () => ({ slackHook: { run: deliver } }))
vi.mock(
  '@/lib/server/domains/plan-limits/plan-limits.service',
  async () =>
    (await import('@/lib/server/domains/plan-limits/__tests__/feature-states'))
      .planLimitsServiceDouble
)

const fixture = await createDbTestFixture()
beforeEach(fixture.begin)
afterEach(async () => {
  vi.clearAllMocks()
  await fixture.rollback()
})
afterAll(fixture.close)

async function queueNotification() {
  const [person] = await testDb
    .insert(user)
    .values({ name: 'Acme person', email: `${createId('user')}@example.com` })
    .returning()
  const [author] = await testDb
    .insert(principal)
    .values({ userId: person.id, type: 'user', role: 'user', createdAt: new Date() })
    .returning()
  const [conversation] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: author.id, channel: 'messenger', subject: 'Acme question' })
    .returning()
  const [message] = await testDb
    .insert(conversationMessages)
    .values({
      conversationId: conversation.id,
      principalId: author.id,
      senderType: 'visitor',
      content: 'Hello from Acme',
    })
    .returning()
  const [integration] = await testDb
    .insert(integrations)
    .values({
      integrationType: 'slack',
      status: 'active',
      secrets: encryptSecrets({ accessToken: 'acme-token' }),
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
    actor: { type: 'user', principalId: author.id },
    data: {
      isFirstMessage: true,
      conversation: { id: conversation.id, status: 'open', channel: 'messenger', priority: 'none' },
      message: {
        id: message.id,
        conversationId: conversation.id,
        senderType: 'visitor',
        authorPrincipalId: author.id,
        authorName: 'Acme person',
        authorEmail: person.email,
        content: 'Hello from Acme',
        createdAt: new Date().toISOString(),
      },
    },
  }
  const op = await queueHookSync({
    hookType: 'slack',
    event,
    target: { channelId: 'C1' },
    config: { integrationId: integration.id },
  })
  if (!op) throw new Error('Expected a new sync operation')
  return { op, integration }
}

describe.skipIf(!fixture.available)('integration sync and the plan limits pause (real DB)', () => {
  it.each(FEATURE_STATES)('in the %s state', async (state) => {
    const { op, integration } = await queueNotification()
    setFeatureState(state, 'integrations')

    await runIntegrationSync(syncTestJob(op.id))

    const stored = await testDb.query.integrationSyncOperations.findFirst({
      where: eq(operations.id, op.id),
    })
    if (runsWithoutPlanGate(state)) {
      expect(deliver).toHaveBeenCalledOnce()
      expect(stored?.state).toBe('succeeded')
    } else {
      expect(deliver).not.toHaveBeenCalled()
      expect(stored).toMatchObject({ state: 'cancelled', errorCode: 'plan_paused' })
    }
    // The connection and its tokens are kept either way.
    const kept = await testDb.query.integrations.findFirst({
      where: eq(integrations.id, integration.id),
    })
    expect(kept).toMatchObject({ status: 'active', secrets: integration.secrets })
  })
})
