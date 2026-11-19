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
  settings,
} from '@/lib/server/db'
import { encryptSecrets } from '../../encryption'
import { queueHookSync } from '../hooks'
import { runIntegrationSync, sweepIntegrationSync } from '../worker'
import { queueInboundWebhook } from '../inbound'
import { syncTestJob } from './job'
import { slackAppHooks } from '@/integrations/slack/server/hooks'
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
// The provider's control plane registry is out of reach in a test; the local
// disconnect is what this suite pins.
const unregisterInstall = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@/lib/server/integrations/install-registry', () => ({ unregisterInstall }))
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

/**
 * Lifecycle events are never paused: an app uninstall or a token revocation
 * that arrives while integrations are paused disconnects the connection
 * exactly as it does otherwise. Feature traffic on the same channel pauses.
 */
describe.skipIf(!fixture.available)('provider lifecycle events while paused (real DB)', () => {
  async function slackInstall() {
    // The disconnect also reads the workspace's assistant settings.
    const [existing] = await testDb.select({ id: settings.id }).from(settings).limit(1)
    if (!existing) {
      await testDb
        .insert(settings)
        .values({ name: 'Acme', slug: `acme-${createId('user')}`, createdAt: new Date() })
    }
    const [integration] = await testDb
      .insert(integrations)
      .values({
        integrationType: 'slack',
        status: 'active',
        secrets: encryptSecrets({ accessToken: 'acme-token' }),
        config: { workspaceId: 'T1', botUserId: 'Ubot' },
        connectedAt: new Date('2026-01-01T00:00:00.000Z'),
      })
      .returning()
    return integration
  }

  async function deliver(event: Record<string, unknown>) {
    const raw = JSON.stringify({
      type: 'event_callback',
      team_id: 'T1',
      event_id: createId('event'),
      event_time: Math.floor(Date.now() / 1000),
      event,
    })
    await slackAppHooks.handle('events', raw, 'application/json')
    const op = await testDb.query.integrationSyncOperations.findFirst({
      where: eq(operations.kind, 'app-hook'),
      orderBy: (o, { desc }) => [desc(o.createdAt)],
    })
    if (!op) throw new Error('Expected a queued app event')
    await runIntegrationSync(syncTestJob(op.id))
    return testDb.query.integrationSyncOperations.findFirst({ where: eq(operations.id, op.id) })
  }

  it.each([...FEATURE_STATES])('an uninstall disconnects in the %s state', async (state) => {
    const integration = await slackInstall()
    setFeatureState(state, 'integrations')
    await deliver({ type: 'app_uninstalled' })
    const after = await testDb.query.integrations.findFirst({
      where: eq(integrations.id, integration.id),
    })
    expect(after?.status).toBe('disconnected')
    expect(unregisterInstall).toHaveBeenCalledOnce()
  })

  it('a token revocation for the bot disconnects while paused', async () => {
    const integration = await slackInstall()
    setFeatureState('enforced', 'integrations')
    await deliver({ type: 'tokens_revoked', tokens: { bot: ['Ubot'] } })
    const after = await testDb.query.integrations.findFirst({
      where: eq(integrations.id, integration.id),
    })
    expect(after?.status).toBe('disconnected')
  })

  it('a message to the app pauses', async () => {
    const integration = await slackInstall()
    setFeatureState('enforced', 'integrations')
    const op = await deliver({ type: 'message', channel_type: 'im', user: 'U1', text: 'hi' })
    expect(op).toMatchObject({ state: 'cancelled', errorCode: 'plan_paused' })
    const after = await testDb.query.integrations.findFirst({
      where: eq(integrations.id, integration.id),
    })
    expect(after?.status).toBe('active')
  })
})

/**
 * Inbound changes (a tracker issue closed during the pause) are held, not
 * dropped: the operation waits with the plan_paused reason and is queued again
 * by the sync sweep once the plan includes integrations. One held past the
 * maximum age is given up.
 */
describe.skipIf(!fixture.available)('inbound changes while paused (real DB)', () => {
  const DAY = 24 * 60 * 60 * 1000

  async function inboundOp() {
    const [integration] = await testDb
      .insert(integrations)
      .values({
        integrationType: 'linear',
        status: 'active',
        config: { channelId: 'team_1', webhookSecret: 'whsec_acme' },
      })
      .returning()
    const op = await queueInboundWebhook(
      integration,
      JSON.stringify({ action: 'update', type: 'Issue' }),
      createId('event')
    )
    if (!op) throw new Error('Expected an inbound operation')
    return op
  }

  async function stored(id: string) {
    return testDb.query.integrationSyncOperations.findFirst({ where: eq(operations.id, id) })
  }

  it('holds an inbound change while paused and applies it after an upgrade', async () => {
    const op = await inboundOp()
    setFeatureState('enforced', 'integrations')
    await runIntegrationSync(syncTestJob(op.id))
    expect(await stored(op.id)).toMatchObject({ state: 'retry_wait', errorCode: 'plan_paused' })

    // Still paused: the sweep leaves it held.
    await sweepIntegrationSync()
    expect(await stored(op.id)).toMatchObject({ state: 'retry_wait', errorCode: 'plan_paused' })

    setFeatureState('included', 'integrations')
    await sweepIntegrationSync()
    const resumed = await stored(op.id)
    expect(resumed).toMatchObject({ state: 'queued', errorCode: null })
    await runIntegrationSync(syncTestJob(op.id))
    expect((await stored(op.id))?.state).toBe('succeeded')
  })

  it('gives up a change held past the maximum age', async () => {
    const op = await inboundOp()
    setFeatureState('enforced', 'integrations')
    await runIntegrationSync(syncTestJob(op.id))
    await testDb
      .update(operations)
      .set({ createdAt: new Date(Date.now() - 31 * DAY) })
      .where(eq(operations.id, op.id))
    await sweepIntegrationSync()
    expect(await stored(op.id)).toMatchObject({ state: 'cancelled', errorCode: 'plan_paused' })
  })

  it('gives up a change already past the maximum age when the worker reaches it', async () => {
    const op = await inboundOp()
    await testDb
      .update(operations)
      .set({ createdAt: new Date(Date.now() - 31 * DAY) })
      .where(eq(operations.id, op.id))
    setFeatureState('enforced', 'integrations')
    await runIntegrationSync(syncTestJob(op.id))
    expect(await stored(op.id)).toMatchObject({ state: 'cancelled', errorCode: 'plan_paused' })
  })

  it('still cancels outbound feature traffic while paused', async () => {
    const { op } = await queueNotification()
    setFeatureState('enforced', 'integrations')
    await runIntegrationSync(syncTestJob(op.id))
    expect(await stored(op.id)).toMatchObject({ state: 'cancelled', errorCode: 'plan_paused' })
  })
})
