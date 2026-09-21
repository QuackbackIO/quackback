import { getIntegration } from '@/lib/server/integrations'
/** Exercises verified receipt, fan-out and domain effects against PostgreSQL. */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createHmac } from 'crypto'
import {
  createId,
  type PrincipalId,
  type TicketId,
  type TicketStatusId,
  type UserId,
} from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  tickets,
  ticketStatuses,
  ticketExternalLinks,
  ticketLinks,
  postExternalLinks,
  posts,
  boards,
  settings,
  integrations,
  user,
  principal,
  eq,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/secret-key', () => ({
  activeSecretKey: () => 'integration-sync-test-key-32-characters-only',
}))

// Neutralize the fire-and-forget webhook bridge (createTicket/setTicketStatus).
vi.mock('@/lib/server/domains/tickets/ticket.webhooks', () => ({
  emitTicketCreated: vi.fn().mockResolvedValue(undefined),
  emitTicketStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitTicketAssigned: vi.fn().mockResolvedValue(undefined),
  emitTicketExternalStatusChanged: vi.fn().mockResolvedValue(undefined),
}))

// Neutralize the real Postgres-backed realtime publish.
vi.mock('@/lib/server/realtime/conversation-channels', () => ({ publishTicketEvent: vi.fn() }))

import { handleInboundWebhook } from '../inbound-webhook-handler'
import { runIntegrationSync } from '../sync/worker'
import { syncTestJob } from '../sync/__tests__/job'
import { installationIdentity, syncDestination, syncHash } from '../sync/identity'
import { integrationSyncOperations as operations, events, and, inArray } from '@/lib/server/db'
import { createTicket } from '@/lib/server/domains/tickets/ticket.service'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'
import type { Actor } from '@/lib/server/policy/types'
import { conversationMessages } from '@/lib/server/db'
import { publishTicketEvent } from '@/lib/server/realtime/conversation-channels'
import * as ledger from '../sync/ledger'

const olderRevision = new Date(Date.now() + 60_000).toISOString()
const newerRevision = new Date(Date.now() + 120_000).toISOString()
const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: tickets.id }).from(tickets).limit(0)
    await db.select({ id: ticketExternalLinks.id }).from(ticketExternalLinks).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
const fixtureTickets: TicketId[] = []
const fixtureIntegrationIds: string[] = []
const WEBHOOK_SECRET = 'test_webhook_secret'

async function seedActor(): Promise<Actor> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `Agent-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'admin', type: 'user', createdAt: new Date() })
  return {
    principalId,
    role: 'admin',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: resolveActorPermissions('admin'),
  }
}

async function seedSettings(): Promise<void> {
  await testDb
    .insert(settings)
    .values({ name: 'Test WS', slug: `test_${suffix()}`, createdAt: new Date() })
}

/** A default open status + a closed status; returns both ids. */
async function seedStatuses(): Promise<{ open: TicketStatusId; closed: TicketStatusId }> {
  await testDb
    .update(ticketStatuses)
    .set({ isDefault: false })
    .where(eq(ticketStatuses.isDefault, true))
  const [open] = await testDb
    .insert(ticketStatuses)
    .values({
      name: 'T-Open',
      slug: `t_open_${suffix()}`,
      category: 'open',
      position: 100,
      isDefault: true,
      publicStage: 'received',
    })
    .returning()
  const [closed] = await testDb
    .insert(ticketStatuses)
    .values({
      name: 'T-Resolved',
      slug: `t_res_${suffix()}`,
      category: 'closed',
      position: 300,
      publicStage: 'resolved',
    })
    .returning()
  return { open: open.id, closed: closed.id }
}

async function seedGitHubIntegration(config: Record<string, unknown>) {
  const service = createId('principal')
  await testDb
    .insert(principal)
    .values({ id: service, role: 'user', type: 'service', createdAt: new Date() })
  const [row] = await testDb
    .insert(integrations)
    .values({
      integrationType: 'github',
      status: 'active',
      principalId: service,
      config: {
        channelId: 'acme/widgets',
        webhookSecret: WEBHOOK_SECRET,
        statusSyncEnabled: true,
        ...config,
      },
    })
    .returning()
  fixtureIntegrationIds.push(row.id)
  return row
}

async function seedLinkedTicket(actor: Actor, externalId: string): Promise<TicketId> {
  const integration = (await testDb.query.integrations.findFirst({
    where: eq(integrations.integrationType, 'github'),
  }))!
  const dto = await createTicket({ type: 'customer', title: `customer ${suffix()}` }, actor)
  fixtureTickets.push(dto.id)
  await testDb.insert(ticketExternalLinks).values({
    ticketId: dto.id,
    integrationId: integration.id,
    syncScope: scope(integration),
    integrationType: 'github',
    externalId,
    externalDisplayId: `acme/widgets#${externalId}`,
    externalUrl: `https://github.com/acme/widgets/issues/${externalId}`,
  })
  return dto.id
}

/** A minimal board+post so the post-link FK holds (changeStatus is mocked). */
async function seedMinimalPost(principalId: PrincipalId) {
  const [board] = await testDb
    .insert(boards)
    .values({ slug: `b_${suffix()}`, name: 'Board' })
    .returning()
  const [post] = await testDb
    .insert(posts)
    .values({ boardId: board.id, title: 'Post', content: 'Body', principalId })
    .returning()
  return post.id
}

/** A signed GitHub issues webhook request for the central handler. */
function githubWebhookRequest(
  action: 'closed' | 'reopened',
  issueNumber: number,
  repository = 'acme/widgets'
): Request {
  const body = JSON.stringify({
    action,
    repository: { full_name: repository },
    issue: {
      number: issueNumber,
      updated_at: action === 'closed' ? olderRevision : newerRevision,
    },
  })
  const signature = 'sha256=' + createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')
  return new Request('http://localhost/api/integrations/github/webhook', {
    method: 'POST',
    headers: { 'X-Hub-Signature-256': signature, 'Content-Type': 'application/json' },
    body,
  })
}

async function ticketState(ticketId: TicketId) {
  const [row] = await testDb
    .select({ statusId: tickets.statusId, resolvedAt: tickets.resolvedAt })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
  return row
}

/** Internal system notes on the ticket thread with the given event kind. */
async function systemNotes(ticketId: TicketId, kind: string) {
  const rows = await testDb
    .select({
      content: conversationMessages.content,
      isInternal: conversationMessages.isInternal,
      senderType: conversationMessages.senderType,
      metadata: conversationMessages.metadata,
    })
    .from(conversationMessages)
    .where(eq(conversationMessages.ticketId, ticketId))
  return rows.filter(
    (r) => (r.metadata as { systemEvent?: { kind?: string } })?.systemEvent?.kind === kind
  )
}

function scope(integration: typeof integrations.$inferSelect) {
  return `${installationIdentity(integration)}:${syncHash(syncDestination({ channelId: 'acme/widgets' }, integration.config as Record<string, unknown>, getIntegration(integration.integrationType)))}`
}
async function drain() {
  for (let n = 0; n < 10; n++) {
    const rows = await testDb.query.integrationSyncOperations.findMany({
      where: and(
        eq(operations.state, 'queued'),
        inArray(operations.integrationId, fixtureIntegrationIds)
      ),
    })
    if (!rows.length) return
    for (const row of rows) await runIntegrationSync(syncTestJob(row.id)).catch(() => undefined)
  }
  throw new Error('Queue did not drain')
}
async function receiveAndDrain(request: Request, provider: string) {
  const response = await handleInboundWebhook(request, provider)
  await drain()
  return response
}
async function externalEvents() {
  return testDb
    .select()
    .from(events)
    .where(
      and(
        eq(events.type, 'ticket.external_status_changed'),
        inArray(events.entityId, fixtureTickets)
      )
    )
}

describe.skipIf(!fixture.available)('inbound webhook ticket branch (real DB, rolled back)', () => {
  beforeEach(async () => {
    fixtureTickets.length = 0
    fixtureIntegrationIds.length = 0
    await fixture.begin()
    vi.clearAllMocks()
    vi.mocked(publishTicketEvent).mockReset()
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await fixture.rollback()
  })
  afterAll(fixture.close)

  it('applies the mapped ticket lifecycle and publishes the committed status', async () => {
    await seedSettings()
    const { closed } = await seedStatuses()
    await seedGitHubIntegration({ ticketStatusMappings: { Closed: closed, Open: null } })
    const actor = await seedActor()
    const ticketId = await seedLinkedTicket(actor, '77')
    vi.mocked(publishTicketEvent).mockClear()

    const response = await receiveAndDrain(githubWebhookRequest('closed', 77), 'github')
    expect(response.status).toBe(200)

    const state = await ticketState(ticketId)
    expect(state.statusId).toBe(closed)
    // Applied through setTicketStatus: the closed-category transition stamped resolvedAt.
    expect(state.resolvedAt).not.toBeNull()
    expect(publishTicketEvent).toHaveBeenCalledWith(
      ticketId,
      expect.objectContaining({
        kind: 'ticket_updated',
        ticket: expect.objectContaining({
          id: ticketId,
          status: expect.objectContaining({ id: closed }),
        }),
      })
    )

    // Close-the-loop: a team-only system note lands on the thread with the
    // provider-verb copy, and the agent-watcher bell event fires once.
    const notes = await systemNotes(ticketId, 'external_status_changed')
    expect(notes).toHaveLength(1)
    expect(notes[0].content).toBe('GitHub issue acme/widgets#77 was closed')
    expect(notes[0].isInternal).toBe(true)
    expect(notes[0].senderType).toBe('system')
    expect(await externalEvents()).toHaveLength(1)
    expect((await externalEvents())[0].payload).toMatchObject({
      integrationType: 'github',
      externalDisplayId: 'acme/widgets#77',
      externalStatus: 'Closed',
      transition: 'closed',
    })

    // WO-14: the link's remote_state is cached and the integration's inbound
    // health timestamp is stamped.
    const [link] = await testDb
      .select({ remoteState: ticketExternalLinks.remoteState })
      .from(ticketExternalLinks)
      .where(eq(ticketExternalLinks.ticketId, ticketId))
    expect(link.remoteState).toBe('Closed')
    const [integ] = await testDb
      .select()
      .from(integrations)
      .where(eq(integrations.integrationType, 'github'))
    const { readSyncHealth } = await import('../sync/health')
    expect((await readSyncHealth(integ)).lastInboundAt).not.toBeNull()
  })

  it('publishes tracker and cascaded customer status changes, without duplicate delivery', async () => {
    await seedSettings()
    const { closed } = await seedStatuses()
    await seedGitHubIntegration({ ticketStatusMappings: { Closed: closed } })
    const actor = await seedActor()
    const trackerId = await seedLinkedTicket(actor, '88')
    await testDb.update(tickets).set({ type: 'tracker' }).where(eq(tickets.id, trackerId))
    const customer = await createTicket({ type: 'customer', title: 'Tracked customer' }, actor)
    await testDb
      .insert(ticketLinks)
      .values({ trackerTicketId: trackerId, linkedTicketId: customer.id, relation: 'tracks' })
    vi.mocked(publishTicketEvent).mockClear()
    await receiveAndDrain(githubWebhookRequest('closed', 88), 'github')
    expect((await ticketState(customer.id)).statusId).toBe(closed)
    expect(publishTicketEvent).toHaveBeenCalledTimes(2)
    for (const id of [trackerId, customer.id])
      expect(publishTicketEvent).toHaveBeenCalledWith(
        id,
        expect.objectContaining({
          kind: 'ticket_updated',
          ticket: expect.objectContaining({ id, status: expect.objectContaining({ id: closed }) }),
        })
      )
    await receiveAndDrain(githubWebhookRequest('closed', 88), 'github')
    expect(publishTicketEvent).toHaveBeenCalledTimes(2)
  })

  it('does not publish a ticket change when the receipt transaction rolls back', async () => {
    await seedSettings()
    const { open, closed } = await seedStatuses()
    await seedGitHubIntegration({ ticketStatusMappings: { Closed: closed } })
    const ticketId = await seedLinkedTicket(await seedActor(), '89')
    vi.mocked(publishTicketEvent).mockClear()
    const finish = ledger.finishSyncOperation
    vi.spyOn(ledger, 'finishSyncOperation').mockImplementation((claim, outcome, persist) =>
      finish(
        claim,
        outcome,
        persist && claim.operation.sourceId === ticketId
          ? async (tx) => {
              await persist(tx)
              throw new Error('Receipt completion failed')
            }
          : persist
      )
    )
    await receiveAndDrain(githubWebhookRequest('closed', 89), 'github')
    expect((await ticketState(ticketId)).statusId).toBe(open)
    expect(publishTicketEvent).not.toHaveBeenCalled()
    expect(await externalEvents()).toHaveLength(0)
  })

  it('keeps committed status and delivery success when realtime publication fails', async () => {
    await seedSettings()
    const { closed } = await seedStatuses()
    await seedGitHubIntegration({ ticketStatusMappings: { Closed: closed } })
    const ticketId = await seedLinkedTicket(await seedActor(), '94')
    vi.mocked(publishTicketEvent).mockClear()
    vi.mocked(publishTicketEvent).mockImplementationOnce(() => {
      throw new Error('Realtime unavailable')
    })
    await receiveAndDrain(githubWebhookRequest('closed', 94), 'github')
    expect((await ticketState(ticketId)).statusId).toBe(closed)
    expect(publishTicketEvent).toHaveBeenCalledTimes(1)
    expect(
      await testDb.query.integrationSyncOperations.findFirst({
        where: eq(operations.sourceId, ticketId),
      })
    ).toMatchObject({ state: 'succeeded' })
  })

  it('notes and bells even when NO ticket status mapping matches (the silence case)', async () => {
    await seedSettings()
    const { open } = await seedStatuses()
    await seedGitHubIntegration({}) // no ticketStatusMappings at all
    const actor = await seedActor()
    const ticketId = await seedLinkedTicket(actor, '90')

    const response = await receiveAndDrain(githubWebhookRequest('closed', 90), 'github')
    expect(response.status).toBe(200)

    // Status untouched (no mapping) — but the external fact still lands.
    expect((await ticketState(ticketId)).statusId).toBe(open)
    const notes = await systemNotes(ticketId, 'external_status_changed')
    expect(notes).toHaveLength(1)
    expect(notes[0].content).toContain('was closed')
    expect(await externalEvents()).toHaveLength(1)
  })

  it('reopened note uses the reopened verb', async () => {
    await seedSettings()
    await seedStatuses()
    await seedGitHubIntegration({})
    const actor = await seedActor()
    const ticketId = await seedLinkedTicket(actor, '91')

    await receiveAndDrain(githubWebhookRequest('reopened', 91), 'github')
    const notes = await systemNotes(ticketId, 'external_status_changed')
    expect(notes).toHaveLength(1)
    expect(notes[0].content).toBe('GitHub issue acme/widgets#91 was reopened')
  })

  it('a redelivered webhook does not double-note or double-bell (delivery-key dedup)', async () => {
    await seedSettings()
    await seedStatuses()
    await seedGitHubIntegration({})
    const actor = await seedActor()
    const ticketId = await seedLinkedTicket(actor, '93')

    // Same body twice = a provider redelivery (byte-identical payload).
    await receiveAndDrain(githubWebhookRequest('closed', 93), 'github')
    await receiveAndDrain(githubWebhookRequest('closed', 93), 'github')

    expect(await systemNotes(ticketId, 'external_status_changed')).toHaveLength(1)
    expect(await externalEvents()).toHaveLength(1)

    // A genuinely different event (reopen) still lands.
    await receiveAndDrain(githubWebhookRequest('reopened', 93), 'github')
    expect(await systemNotes(ticketId, 'external_status_changed')).toHaveLength(2)
    expect(await externalEvents()).toHaveLength(2)
  })

  it('notes every ticket linked to the same issue', async () => {
    await seedSettings()
    const { closed } = await seedStatuses()
    await seedGitHubIntegration({ ticketStatusMappings: { Closed: closed } })
    const actor = await seedActor()
    const a = await seedLinkedTicket(actor, '92')
    const b = await seedLinkedTicket(actor, '92')

    await receiveAndDrain(githubWebhookRequest('closed', 92), 'github')
    expect(await systemNotes(a, 'external_status_changed')).toHaveLength(1)
    expect(await systemNotes(b, 'external_status_changed')).toHaveLength(1)
    expect(await externalEvents()).toHaveLength(2)
  })

  it('reopens: issues.reopened maps back through the Open mapping', async () => {
    await seedSettings()
    const { open, closed } = await seedStatuses()
    await seedGitHubIntegration({ ticketStatusMappings: { Closed: closed, Open: open } })
    const actor = await seedActor()
    const ticketId = await seedLinkedTicket(actor, '78')

    await receiveAndDrain(githubWebhookRequest('closed', 78), 'github')
    expect((await ticketState(ticketId)).statusId).toBe(closed)

    await receiveAndDrain(githubWebhookRequest('reopened', 78), 'github')
    const state = await ticketState(ticketId)
    expect(state.statusId).toBe(open)
    expect(state.resolvedAt).toBeNull()
  })

  it('updates every ticket linked to the same issue', async () => {
    await seedSettings()
    const { closed } = await seedStatuses()
    await seedGitHubIntegration({ ticketStatusMappings: { Closed: closed } })
    const actor = await seedActor()
    const a = await seedLinkedTicket(actor, '80')
    const b = await seedLinkedTicket(actor, '80')

    await receiveAndDrain(githubWebhookRequest('closed', 80), 'github')
    expect((await ticketState(a)).statusId).toBe(closed)
    expect((await ticketState(b)).statusId).toBe(closed)
  })

  it('ignores the event when no ticket status mapping exists', async () => {
    await seedSettings()
    const { open } = await seedStatuses()
    await seedGitHubIntegration({}) // no ticketStatusMappings
    const actor = await seedActor()
    const ticketId = await seedLinkedTicket(actor, '79')

    const response = await receiveAndDrain(githubWebhookRequest('closed', 79), 'github')
    expect(response.status).toBe(200)
    expect((await ticketState(ticketId)).statusId).toBe(open)
  })

  it('preserves ticket progress when a post branch mapping fails', async () => {
    await seedSettings()
    const { closed } = await seedStatuses()
    const postStatusId = createId('post_status')
    const integration = await seedGitHubIntegration({
      statusMappings: { Closed: postStatusId },
      ticketStatusMappings: { Closed: closed },
    })
    // The post branch requires a service principal on the integration.
    const svcPrincipal = createId('principal') as PrincipalId
    await testDb
      .insert(principal)
      .values({ id: svcPrincipal, role: 'user', type: 'service', createdAt: new Date() })
    await testDb
      .update(integrations)
      .set({ principalId: svcPrincipal })
      .where(eq(integrations.id, integration.id))

    const actor = await seedActor()
    const ticketId = await seedLinkedTicket(actor, '81')
    // A post linked to the same external id (changeStatus itself is mocked,
    // so only the link row needs to be real).
    const postId = await seedMinimalPost(actor.principalId!)
    await testDb.insert(postExternalLinks).values({
      postId,
      integrationId: integration.id,
      syncScope: scope(integration),
      integrationType: 'github',
      externalId: '81',
    })

    await receiveAndDrain(githubWebhookRequest('closed', 81), 'github')

    const postOp = await testDb.query.integrationSyncOperations.findFirst({
      where: and(eq(operations.sourceId, postId), eq(operations.kind, 'status')),
    })
    expect(postOp?.state).toBe('retry_wait')
    expect((await ticketState(ticketId)).statusId).toBe(closed)
  })

  it('acknowledges the durable receipt before applying local effects', async () => {
    await seedSettings()
    const { open, closed } = await seedStatuses()
    await seedGitHubIntegration({ ticketStatusMappings: { Closed: closed } })
    const ticketId = await seedLinkedTicket(await seedActor(), '84')
    expect((await handleInboundWebhook(githubWebhookRequest('closed', 84), 'github')).status).toBe(
      200
    )
    expect((await ticketState(ticketId)).statusId).toBe(open)
    expect(
      await testDb.query.integrationSyncOperations.findMany({
        where: inArray(operations.integrationId, fixtureIntegrationIds),
      })
    ).toHaveLength(1)
    await drain()
    expect((await ticketState(ticketId)).statusId).toBe(closed)
  })

  it('does not apply the same issue number from another repository', async () => {
    await seedSettings()
    const { open, closed } = await seedStatuses()
    await seedGitHubIntegration({ ticketStatusMappings: { Closed: closed } })
    const ticketId = await seedLinkedTicket(await seedActor(), '85')
    await receiveAndDrain(githubWebhookRequest('closed', 85, 'other/widgets'), 'github')
    expect((await ticketState(ticketId)).statusId).toBe(open)
    expect(await systemNotes(ticketId, 'external_status_changed')).toHaveLength(0)
    const op = await testDb.query.integrationSyncOperations.findFirst({
      where: eq(operations.sourceId, ticketId),
    })
    expect(op).toBeUndefined()
  })

  it('leaves a reference-only association untouched without importing a child operation', async () => {
    await seedSettings()
    const { open, closed } = await seedStatuses()
    await seedGitHubIntegration({ ticketStatusMappings: { Closed: closed } })
    const ticketId = await seedLinkedTicket(await seedActor(), '87')
    await testDb
      .update(ticketExternalLinks)
      .set({ syncScope: '' })
      .where(eq(ticketExternalLinks.ticketId, ticketId))
    await receiveAndDrain(githubWebhookRequest('closed', 87), 'github')
    expect((await ticketState(ticketId)).statusId).toBe(open)
    expect(
      await testDb.query.integrationSyncOperations.findMany({
        where: eq(operations.sourceId, ticketId),
      })
    ).toHaveLength(0)
    expect(await systemNotes(ticketId, 'external_status_changed')).toHaveLength(0)
  })

  it('does not regress a ticket when an older status arrives last', async () => {
    await seedSettings()
    const { open, closed } = await seedStatuses()
    await seedGitHubIntegration({ ticketStatusMappings: { Closed: closed, Open: open } })
    const ticketId = await seedLinkedTicket(await seedActor(), '86')
    await receiveAndDrain(githubWebhookRequest('reopened', 86), 'github')
    await receiveAndDrain(githubWebhookRequest('closed', 86), 'github')
    expect((await ticketState(ticketId)).statusId).toBe(open)
    expect(await systemNotes(ticketId, 'external_status_changed')).toHaveLength(1)
    const older = await testDb.query.integrationSyncOperations.findFirst({
      where: and(eq(operations.sourceId, ticketId), eq(operations.state, 'superseded')),
    })
    expect(older).toBeDefined()
  })

  it('acknowledges a malformed body with 200 not 500', async () => {
    await seedSettings()
    await seedGitHubIntegration({})
    const body = '{not-json'
    const signature = 'sha256=' + createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')
    const request = new Request('http://localhost/api/integrations/github/webhook', {
      method: 'POST',
      headers: { 'X-Hub-Signature-256': signature, 'Content-Type': 'application/json' },
      body,
    })
    const response = await handleInboundWebhook(request, 'github')
    expect(response.status).toBe(200)
  })

  it('rejects a bad signature', async () => {
    await seedSettings()
    const { closed } = await seedStatuses()
    await seedGitHubIntegration({ ticketStatusMappings: { Closed: closed } })
    const actor = await seedActor()
    const ticketId = await seedLinkedTicket(actor, '82')

    const body = JSON.stringify({ action: 'closed', issue: { number: 82 } })
    const request = new Request('http://localhost/api/integrations/github/webhook', {
      method: 'POST',
      headers: { 'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64) },
      body,
    })
    const response = await handleInboundWebhook(request, 'github')
    expect(response.status).toBe(401)
    expect((await ticketState(ticketId)).statusId).not.toBe(closed)
  })
})
