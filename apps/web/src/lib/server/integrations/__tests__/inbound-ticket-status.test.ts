/**
 * Real-DB coverage for the inbound webhook handler's ticket branch: a GitHub
 * issues.closed/reopened webhook reverse-looks-up ticket_external_links by
 * external ID, resolves config.ticketStatusMappings, and applies the status
 * through setTicketStatus (so lifecycle stamps like resolvedAt land). The
 * post branch (changeStatus) is mocked to verify the two branches stay
 * independent. Runs inside the fixture rollback.
 */
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

// Post branch boundary: assert call args instead of standing up the whole
// post domain (boards/posts/events) in this suite.
vi.mock('@/lib/server/domains/posts/post.status', () => ({
  changeStatus: vi.fn().mockResolvedValue(undefined),
}))

// Neutralize the fire-and-forget webhook bridge (createTicket/setTicketStatus).
vi.mock('@/lib/server/domains/tickets/ticket.webhooks', () => ({
  emitTicketCreated: vi.fn().mockResolvedValue(undefined),
  emitTicketStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitTicketAssigned: vi.fn().mockResolvedValue(undefined),
  emitTicketExternalStatusChanged: vi.fn().mockResolvedValue(undefined),
}))

// Neutralize the real Redis-backed realtime publish.
vi.mock('@/lib/server/realtime/conversation-channels', () => ({ publishTicketEvent: vi.fn() }))

import { handleInboundWebhook } from '../inbound-webhook-handler'
import { changeStatus } from '@/lib/server/domains/posts/post.status'
import { createTicket } from '@/lib/server/domains/tickets/ticket.service'
import { emitTicketExternalStatusChanged } from '@/lib/server/domains/tickets/ticket.webhooks'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'
import type { Actor } from '@/lib/server/policy/types'
import { conversationMessages } from '@/lib/server/db'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: tickets.id }).from(tickets).limit(0)
    await db.select({ id: ticketExternalLinks.id }).from(ticketExternalLinks).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
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
  const [row] = await testDb
    .insert(integrations)
    .values({
      integrationType: 'github',
      status: 'active',
      config: { channelId: 'acme/widgets', webhookSecret: WEBHOOK_SECRET, ...config },
    })
    .returning()
  return row
}

async function seedLinkedTicket(actor: Actor, externalId: string): Promise<TicketId> {
  const dto = await createTicket({ type: 'customer', title: `customer ${suffix()}` }, actor)
  await testDb.insert(ticketExternalLinks).values({
    ticketId: dto.id,
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
function githubWebhookRequest(action: 'closed' | 'reopened', issueNumber: number): Request {
  const body = JSON.stringify({ action, issue: { number: issueNumber } })
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

describe.skipIf(!fixture.available)('inbound webhook ticket branch (real DB, rolled back)', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.mocked(changeStatus).mockClear()
    vi.mocked(emitTicketExternalStatusChanged).mockClear()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('applies the mapped ticket status on issues.closed via setTicketStatus', async () => {
    await seedSettings()
    const { closed } = await seedStatuses()
    await seedGitHubIntegration({ ticketStatusMappings: { Closed: closed, Open: null } })
    const actor = await seedActor()
    const ticketId = await seedLinkedTicket(actor, '77')

    const response = await handleInboundWebhook(githubWebhookRequest('closed', 77), 'github')
    expect(response.status).toBe(200)

    const state = await ticketState(ticketId)
    expect(state.statusId).toBe(closed)
    // Applied through setTicketStatus: the closed-category transition stamped resolvedAt.
    expect(state.resolvedAt).not.toBeNull()

    // No post is linked to this external id, so the post path stayed idle.
    expect(changeStatus).not.toHaveBeenCalled()

    // Close-the-loop: a team-only system note lands on the thread with the
    // provider-verb copy, and the agent-watcher bell event fires once.
    const notes = await systemNotes(ticketId, 'external_status_changed')
    expect(notes).toHaveLength(1)
    expect(notes[0].content).toBe('GitHub issue acme/widgets#77 was closed')
    expect(notes[0].isInternal).toBe(true)
    expect(notes[0].senderType).toBe('system')
    expect(emitTicketExternalStatusChanged).toHaveBeenCalledTimes(1)
    expect(vi.mocked(emitTicketExternalStatusChanged).mock.calls[0][2]).toMatchObject({
      integrationType: 'github',
      externalDisplayId: 'acme/widgets#77',
      externalStatus: 'Closed',
      transition: 'closed',
    })
  })

  it('notes and bells even when NO ticket status mapping matches (the silence case)', async () => {
    await seedSettings()
    const { open } = await seedStatuses()
    await seedGitHubIntegration({}) // no ticketStatusMappings at all
    const actor = await seedActor()
    const ticketId = await seedLinkedTicket(actor, '90')

    const response = await handleInboundWebhook(githubWebhookRequest('closed', 90), 'github')
    expect(response.status).toBe(200)

    // Status untouched (no mapping) — but the external fact still lands.
    expect((await ticketState(ticketId)).statusId).toBe(open)
    const notes = await systemNotes(ticketId, 'external_status_changed')
    expect(notes).toHaveLength(1)
    expect(notes[0].content).toContain('was closed')
    expect(emitTicketExternalStatusChanged).toHaveBeenCalledTimes(1)
  })

  it('reopened note uses the reopened verb', async () => {
    await seedSettings()
    await seedStatuses()
    await seedGitHubIntegration({})
    const actor = await seedActor()
    const ticketId = await seedLinkedTicket(actor, '91')

    await handleInboundWebhook(githubWebhookRequest('reopened', 91), 'github')
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
    await handleInboundWebhook(githubWebhookRequest('closed', 93), 'github')
    await handleInboundWebhook(githubWebhookRequest('closed', 93), 'github')

    expect(await systemNotes(ticketId, 'external_status_changed')).toHaveLength(1)
    expect(emitTicketExternalStatusChanged).toHaveBeenCalledTimes(1)

    // A genuinely different event (reopen) still lands.
    await handleInboundWebhook(githubWebhookRequest('reopened', 93), 'github')
    expect(await systemNotes(ticketId, 'external_status_changed')).toHaveLength(2)
    expect(emitTicketExternalStatusChanged).toHaveBeenCalledTimes(2)
  })

  it('notes every ticket linked to the same issue', async () => {
    await seedSettings()
    const { closed } = await seedStatuses()
    await seedGitHubIntegration({ ticketStatusMappings: { Closed: closed } })
    const actor = await seedActor()
    const a = await seedLinkedTicket(actor, '92')
    const b = await seedLinkedTicket(actor, '92')

    await handleInboundWebhook(githubWebhookRequest('closed', 92), 'github')
    expect(await systemNotes(a, 'external_status_changed')).toHaveLength(1)
    expect(await systemNotes(b, 'external_status_changed')).toHaveLength(1)
    expect(emitTicketExternalStatusChanged).toHaveBeenCalledTimes(2)
  })

  it('reopens: issues.reopened maps back through the Open mapping', async () => {
    await seedSettings()
    const { open, closed } = await seedStatuses()
    await seedGitHubIntegration({ ticketStatusMappings: { Closed: closed, Open: open } })
    const actor = await seedActor()
    const ticketId = await seedLinkedTicket(actor, '78')

    await handleInboundWebhook(githubWebhookRequest('closed', 78), 'github')
    expect((await ticketState(ticketId)).statusId).toBe(closed)

    await handleInboundWebhook(githubWebhookRequest('reopened', 78), 'github')
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

    await handleInboundWebhook(githubWebhookRequest('closed', 80), 'github')
    expect((await ticketState(a)).statusId).toBe(closed)
    expect((await ticketState(b)).statusId).toBe(closed)
  })

  it('ignores the event when no ticket status mapping exists', async () => {
    await seedSettings()
    const { open } = await seedStatuses()
    await seedGitHubIntegration({}) // no ticketStatusMappings
    const actor = await seedActor()
    const ticketId = await seedLinkedTicket(actor, '79')

    const response = await handleInboundWebhook(githubWebhookRequest('closed', 79), 'github')
    expect(response.status).toBe(200)
    expect((await ticketState(ticketId)).statusId).toBe(open)
  })

  it('still runs the post branch when both a post and a ticket link exist', async () => {
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
      integrationType: 'github',
      externalId: '81',
    })

    await handleInboundWebhook(githubWebhookRequest('closed', 81), 'github')

    expect(changeStatus).toHaveBeenCalledTimes(1)
    expect(vi.mocked(changeStatus).mock.calls[0][0]).toBe(postId)
    expect(vi.mocked(changeStatus).mock.calls[0][1]).toBe(postStatusId)
    expect((await ticketState(ticketId)).statusId).toBe(closed)
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
