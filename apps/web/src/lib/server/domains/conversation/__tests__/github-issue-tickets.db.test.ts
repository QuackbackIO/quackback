/**
 * GitHub issues as tickets, against a real database with GitHub's API
 * stubbed. A `tickets`-mode repository turns each new issue into an inbox
 * conversation paired with a customer ticket (scope team and type, the
 * author as requester, the title cut to the ticket bound, our footer and
 * marker left out); a redelivery opens nothing twice and a `conversations`
 * repository opens no ticket. Closing and reopening the issue moves the
 * ticket (repository mapping, then the connection's, then defaults), an edit
 * renames it, and both ignore our own bot. A ticket closed in Quackback
 * closes the issue, while a close that came from GitHub is never sent back.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  createId,
  type PrincipalId,
  type TeamId,
  type TicketId,
  type TicketStatusId,
} from '@quackback/ids'

process.env.BASE_URL = 'https://quackback.test'
process.env.SECRET_KEY ||= 'x'.repeat(32)

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  teams,
  channelAccounts,
  conversations,
  conversationMessages,
  integrations,
  integrationDestinations,
  principal,
  user,
  tickets,
  ticketStatuses,
  ticketTypes,
  ticketConversations,
  events,
  settings,
  eq,
  and,
  desc,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/realtime/pubsub', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/realtime/pubsub')>()),
  publish: vi.fn(),
  publishAsync: vi.fn(async () => {}),
}))

import { ingestGitHubChannelEvent } from '../conversation.github-inbound'
import { syncGitHubIssueFromTicketEvent } from '../conversation.github-tickets'
import { setTicketStatus } from '@/lib/server/domains/tickets/ticket.service'
import { hydrateEvent } from '@/lib/server/events/outbox'
import { toLegacyEvent } from '@/lib/server/events/to-legacy-event'
import { encryptSecrets } from '@/lib/server/integrations/encryption'
import type { Actor } from '@/lib/server/policy/types'
import type { EventData } from '@/lib/server/events/types'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: integrationDestinations.id }).from(integrationDestinations).limit(0)
  },
})

type IntegrationRow = typeof integrations.$inferSelect
type RepositoryRow = typeof integrationDestinations.$inferSelect

const statusId = async (slug: string) =>
  (await testDb.query.ticketStatuses.findFirst({ where: eq(ticketStatuses.slug, slug) }))!
    .id as TicketStatusId

describe.skipIf(!fixture.available)('GitHub issues as tickets (real DB, rolled back)', () => {
  let calls: { call: string; body: unknown }[]

  beforeEach(async () => {
    await fixture.begin()
    calls = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const call = `${init?.method ?? 'GET'} ${String(input).replace('https://api.github.com', '')}`
      calls.push({ call, body: init?.body ? JSON.parse(String(init.body)) : null })
      if (call.startsWith('PATCH /repos/acme/api/issues/')) return Response.json({})
      throw new Error(`unexpected GitHub call: ${call}`)
    })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await fixture.rollback()
  })
  afterAll(fixture.close)

  async function seed(repositoryConfig: Record<string, unknown>) {
    await testDb
      .insert(settings)
      .values({ name: 'Acme', slug: `acme-${createId('workspace')}`, createdAt: new Date() })
    const [team] = await testDb
      .insert(teams)
      .values({ name: `Inbox ${createId('team')}` })
      .returning()
    await testDb.insert(channelAccounts).values({
      owningTeamId: team.id as TeamId,
      channel: 'github',
      role: 'connection',
      config: {},
    })
    const servicePrincipal = createId('principal')
    await testDb.insert(principal).values({
      id: servicePrincipal,
      type: 'service',
      role: 'member',
      displayName: 'Github Integration',
      createdAt: new Date(),
    })
    const [integration] = await testDb
      .insert(integrations)
      .values({
        integrationType: 'github',
        status: 'active',
        principalId: servicePrincipal,
        config: { channelId: 'acme/api', username: 'acme-bot' },
        secrets: encryptSecrets({ accessToken: 'tok' }),
      })
      .returning()
    const [repository] = await testDb
      .insert(integrationDestinations)
      .values({
        integrationId: integration.id,
        kind: 'repo',
        externalId: 'acme/api',
        config: repositoryConfig,
      })
      .returning()
    return { integration, repository, servicePrincipal }
  }

  async function seedScope() {
    const [billing] = await testDb.insert(teams).values({ name: 'Billing' }).returning()
    const [bug] = await testDb
      .insert(ticketTypes)
      .values({ name: 'Bug report', slug: `bug-${createId('ticket_type')}`, category: 'customer' })
      .returning()
    return { teamId: billing.id as string, ticketTypeId: bug.id as string }
  }

  function issue(over: {
    action?: string
    number?: number
    title?: string
    body?: string
    sender?: string
    stateReason?: string | null
    changes?: Record<string, unknown>
  }) {
    const number = over.number ?? 7
    return JSON.stringify({
      action: over.action ?? 'opened',
      repository: { full_name: 'acme/api', id: 1 },
      sender: { login: over.sender ?? 'jane' },
      changes: over.changes,
      issue: {
        number,
        title: over.title ?? 'Export fails',
        body: over.body ?? 'Steps to reproduce.',
        html_url: `https://github.com/acme/api/issues/${number}`,
        state_reason: over.stateReason ?? null,
        updated_at: new Date().toISOString(),
        user: { id: 42, login: 'jane' },
      },
    })
  }

  const deliver = (
    integration: IntegrationRow,
    repository: RepositoryRow,
    body: string,
    eventName = 'issues'
  ) => ingestGitHubChannelEvent({ body, eventName, integration, destination: repository })

  const pairedTicket = async (conversationId: string) => {
    const [pair] = await testDb
      .select({ ticket: tickets })
      .from(ticketConversations)
      .innerJoin(tickets, eq(tickets.id, ticketConversations.ticketId))
      .where(eq(ticketConversations.conversationId, conversationId as never))
    return pair?.ticket
  }

  const onlyConversation = async () => {
    const rows = await testDb.select().from(conversations)
    expect(rows).toHaveLength(1)
    return rows[0]
  }

  /** The newest `ticket.status_changed` event of a ticket, as its reactions receive it. */
  async function statusEvent(ticketId: string): Promise<EventData> {
    for (let attempt = 0; attempt < 50; attempt++) {
      const [row] = await testDb
        .select()
        .from(events)
        .where(and(eq(events.type, 'ticket.status_changed'), eq(events.entityId, ticketId)))
        .orderBy(desc(events.id))
        .limit(1)
      if (row) return toLegacyEvent(hydrateEvent(row))
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error('no ticket.status_changed event')
  }

  it('opens a customer ticket paired with the conversation, with the scope team and type', async () => {
    const scope = await seedScope()
    const { integration, repository, servicePrincipal } = await seed({
      inboundMode: 'tickets',
      ticketScope: scope,
    })
    const title = `Export fails ${'x'.repeat(400)}`
    await deliver(
      integration,
      repository,
      issue({
        title,
        body: 'Steps to reproduce.\n\n---\n_Priority: high_\n[View in Quackback](https://quackback.test/admin/tickets/1)',
      })
    )

    const conversation = await onlyConversation()
    const ticket = await pairedTicket(conversation.id)
    expect(ticket).toMatchObject({
      type: 'customer',
      ticketTypeId: scope.ticketTypeId,
      assigneeTeamId: scope.teamId,
      requesterPrincipalId: conversation.visitorPrincipalId,
      statusId: await statusId('new'),
    })
    expect(ticket.title).toHaveLength(300)
    expect(ticket.title.endsWith('...')).toBe(true)
    const [opening] = await testDb
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversation.id))
      .limit(1)
    expect(opening.content).toBe('Steps to reproduce.')
    const [created] = await testDb
      .select()
      .from(events)
      .where(and(eq(events.type, 'ticket.created'), eq(events.entityId, ticket.id)))
    expect(created).toMatchObject({ actorType: 'service', actorId: servicePrincipal })
  })

  it('opens nothing twice for a redelivered issue', async () => {
    const { integration, repository } = await seed({ inboundMode: 'tickets' })
    await deliver(integration, repository, issue({}))
    await deliver(integration, repository, issue({}))
    expect(await testDb.select().from(conversations)).toHaveLength(1)
    expect(await testDb.select().from(ticketConversations)).toHaveLength(1)
  })

  it('opens the missing ticket when a redelivery finds the conversation alone', async () => {
    const { integration, repository } = await seed({ inboundMode: 'conversations' })
    await deliver(integration, repository, issue({}))
    const conversation = await onlyConversation()
    expect(await pairedTicket(conversation.id)).toBeUndefined()

    const tickets = { ...repository, config: { inboundMode: 'tickets' as const } }
    await deliver(integration, tickets, issue({}))
    expect((await pairedTicket(conversation.id))?.title).toBe('Export fails')
  })

  it('opens no ticket for a conversations repository, or for an issue we wrote', async () => {
    const conversationsMode = await seed({ inboundMode: 'conversations' })
    await deliver(conversationsMode.integration, conversationsMode.repository, issue({}))
    await deliver(
      conversationsMode.integration,
      { ...conversationsMode.repository, config: { inboundMode: 'tickets' } },
      issue({ number: 8, body: 'Ours\n<!-- quackback:ticket-issue ticketId=ticket_1 -->' })
    )
    expect(await testDb.select().from(conversations)).toHaveLength(1)
    expect(await testDb.select().from(ticketConversations)).toHaveLength(0)
  })

  it('moves the ticket as the issue closes and reopens, by default', async () => {
    const { integration, repository } = await seed({ inboundMode: 'tickets' })
    await deliver(integration, repository, issue({}))
    const conversation = await onlyConversation()

    await deliver(integration, repository, issue({ action: 'closed', stateReason: 'not_planned' }))
    expect((await pairedTicket(conversation.id)).statusId).toBe(await statusId('wont_do'))

    await deliver(integration, repository, issue({ action: 'reopened' }))
    expect((await pairedTicket(conversation.id)).statusId).toBe(await statusId('new'))

    await deliver(integration, repository, issue({ action: 'closed', stateReason: 'completed' }))
    const closed = await pairedTicket(conversation.id)
    expect(closed.statusId).toBe(await statusId('resolved'))
    expect(closed.resolvedAt).not.toBeNull()
    expect((await testDb.query.conversations.findFirst())?.status).toBe('closed')
  })

  it("prefers the repository's mapping, then the connection's, and a not-planned close falls back to Closed", async () => {
    const { integration, repository } = await seed({
      inboundMode: 'tickets',
      ticketStatusMappings: { Closed: await statusId('duplicate') },
    })
    const connection = {
      ...integration,
      config: {
        ...(integration.config as Record<string, unknown>),
        ticketStatusMappings: {
          Closed: await statusId('resolved'),
          Open: await statusId('investigating'),
        },
      },
    }
    await deliver(connection, repository, issue({}))
    const conversation = await onlyConversation()

    await deliver(connection, repository, issue({ action: 'closed', stateReason: 'not_planned' }))
    expect((await pairedTicket(conversation.id)).statusId).toBe(await statusId('duplicate'))

    await deliver(connection, repository, issue({ action: 'reopened' }))
    expect((await pairedTicket(conversation.id)).statusId).toBe(await statusId('investigating'))

    const unmapped = { ...repository, config: { inboundMode: 'tickets' as const } }
    await deliver(connection, unmapped, issue({ action: 'closed', stateReason: 'completed' }))
    expect((await pairedTicket(conversation.id)).statusId).toBe(await statusId('resolved'))
  })

  it('leaves the ticket alone when our bot closed the issue', async () => {
    const { integration, repository } = await seed({ inboundMode: 'tickets' })
    await deliver(integration, repository, issue({}))
    const conversation = await onlyConversation()
    await deliver(integration, repository, issue({ action: 'closed', sender: 'acme-bot' }))
    expect((await pairedTicket(conversation.id)).statusId).toBe(await statusId('new'))
  })

  it("renames the ticket and the conversation after an edited issue, but not after our bot's edit", async () => {
    const { integration, repository } = await seed({ inboundMode: 'tickets' })
    await deliver(integration, repository, issue({}))
    const conversation = await onlyConversation()

    await deliver(
      integration,
      repository,
      issue({
        action: 'edited',
        title: 'Export fails on Safari',
        changes: { title: { from: 'x' } },
      })
    )
    expect((await pairedTicket(conversation.id)).title).toBe('Export fails on Safari')
    expect((await testDb.query.conversations.findFirst())?.subject).toBe('Export fails on Safari')

    await deliver(
      integration,
      repository,
      issue({ action: 'edited', title: 'Bot title', sender: 'acme-bot', changes: { title: {} } })
    )
    expect((await pairedTicket(conversation.id)).title).toBe('Export fails on Safari')
  })

  it('brings issue comments into the shared thread', async () => {
    const { integration, repository } = await seed({ inboundMode: 'tickets' })
    await deliver(integration, repository, issue({}))
    const conversation = await onlyConversation()
    const ticket = await pairedTicket(conversation.id)
    await ingestGitHubChannelEvent({
      eventName: 'issue_comment',
      integration,
      destination: repository,
      body: JSON.stringify({
        ...JSON.parse(issue({ action: 'created' })),
        comment: { id: 555, body: 'Still broken', user: { id: 42, login: 'jane' } },
      }),
    })

    const { listPairThreadMessages } =
      await import('@/lib/server/domains/tickets/pair-thread.service')
    const thread = await listPairThreadMessages(ticket.id as TicketId, { all: true })
    expect(thread.messages.map((m) => m.content)).toContain('Still broken')
  })

  describe('a ticket moved in Quackback', () => {
    async function pairedIssue(repositoryConfig: Record<string, unknown>) {
      const seeded = await seed(repositoryConfig)
      await deliver(seeded.integration, seeded.repository, issue({}))
      const conversation = await onlyConversation()
      const ticket = await pairedTicket(conversation.id)
      const adminUser = createId('user')
      const admin = createId('principal')
      await testDb
        .insert(user)
        .values({ id: adminUser, name: 'Ada', email: `ada+${adminUser}@example.com` })
      await testDb.insert(principal).values({
        id: admin,
        userId: adminUser,
        type: 'user',
        role: 'admin',
        createdAt: new Date(),
      })
      const actor: Actor = {
        principalId: admin as PrincipalId,
        principalType: 'user',
        role: 'admin',
        segmentIds: new Set(),
      }
      return { ...seeded, ticket, actor }
    }

    it('closes and reopens the issue', async () => {
      const { ticket, actor } = await pairedIssue({ inboundMode: 'tickets' })
      await setTicketStatus(ticket.id as TicketId, await statusId('resolved'), actor)
      await syncGitHubIssueFromTicketEvent(await statusEvent(ticket.id))
      await setTicketStatus(ticket.id as TicketId, await statusId('investigating'), actor)
      await syncGitHubIssueFromTicketEvent(await statusEvent(ticket.id))

      expect(calls).toEqual([
        { call: 'PATCH /repos/acme/api/issues/7', body: { state: 'closed' } },
        { call: 'PATCH /repos/acme/api/issues/7', body: { state: 'open' } },
      ])
    })

    it('ignores a close that runs after the ticket was reopened', async () => {
      const { ticket, actor } = await pairedIssue({ inboundMode: 'tickets' })
      await setTicketStatus(ticket.id as TicketId, await statusId('resolved'), actor)
      const close = await statusEvent(ticket.id)
      await setTicketStatus(ticket.id as TicketId, await statusId('investigating'), actor)

      await syncGitHubIssueFromTicketEvent(close)
      expect(calls).toEqual([])
    })

    it('does not send a close that came from GitHub back to it', async () => {
      const { integration, repository, ticket } = await pairedIssue({ inboundMode: 'tickets' })
      await deliver(integration, repository, issue({ action: 'closed' }))
      const event = await statusEvent(ticket.id)
      expect(event.actor).toMatchObject({ type: 'service', displayName: 'integration-sync' })

      await syncGitHubIssueFromTicketEvent(event)
      expect(calls).toEqual([])
    })

    it('leaves the issue alone for a move it should not make', async () => {
      const { ticket, actor, repository } = await pairedIssue({ inboundMode: 'tickets' })
      await setTicketStatus(ticket.id as TicketId, await statusId('investigating'), actor)
      // Open to open: no close or reopen to mirror.
      await syncGitHubIssueFromTicketEvent(await statusEvent(ticket.id))
      await setTicketStatus(ticket.id as TicketId, await statusId('resolved'), actor)
      const close = await statusEvent(ticket.id)
      // The requester's own move (their comment reopening it) is theirs, not the issue's.
      await syncGitHubIssueFromTicketEvent({
        ...close,
        actor: { type: 'user', principalId: ticket.requesterPrincipalId! },
      } as EventData)
      // A repository that went back to conversations no longer drives its issues from tickets.
      await testDb
        .update(integrationDestinations)
        .set({ config: { inboundMode: 'conversations' } })
        .where(eq(integrationDestinations.id, repository.id))
      await syncGitHubIssueFromTicketEvent(close)
      expect(calls).toEqual([])
    })
  })

  it('titles an issue without a title "Untitled issue"', async () => {
    const { integration, repository } = await seed({ inboundMode: 'tickets' })
    await deliver(integration, repository, issue({ title: '   ' }))
    expect((await pairedTicket((await onlyConversation()).id)).title).toBe('Untitled issue')
  })

  it('records on the repository why a ticket could not be opened, keeping the conversation', async () => {
    const { integration, repository } = await seed({ inboundMode: 'tickets' })
    await testDb.update(ticketStatuses).set({ isDefault: false })
    await expect(deliver(integration, repository, issue({}))).rejects.toThrow(
      'No default ticket status'
    )
    await onlyConversation()
    const after = await testDb.query.integrationDestinations.findFirst({
      where: eq(integrationDestinations.id, repository.id),
    })
    expect(after?.lastError).toMatch(/^Could not open a ticket for acme\/api#7: /)
  })
})
