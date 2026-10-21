/**
 * A repository that opens a GitHub issue for each new ticket it matches,
 * against a real database. The repository's own `ticket.created` and
 * `ticket.assigned` mappings carry its team and ticket-type filters; the
 * resolver routes a matching event to it, the ledger queues the same create a
 * teammate's "Create issue" would (one issue per ticket and repository, made
 * either way), and the worker asks again against the current ticket and
 * repository before calling GitHub.
 *
 * Nothing is opened for what the integration did itself, for a ticket that
 * came from one of its issues, for a switched-off or receive-only repository,
 * or for a ticket opened before the repository opted in. The issue says what
 * the customer-visible thread says, never an internal note or its files.
 */
import { beforeEach, afterEach, afterAll, describe, it, expect, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createId, type PrincipalId, type TicketId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/secret-key', () => ({
  activeSecretKey: () => 'integration-sync-review-key-32-characters-only',
}))
vi.mock('@/lib/server/cache', () => ({
  cacheGet: vi.fn(async () => null),
  cacheSet: vi.fn(async () => {}),
  cacheDel: vi.fn(async () => {}),
  CACHE_KEYS: { INTEGRATION_MAPPINGS: 'mappings' },
}))
vi.mock('@/lib/server/realtime/pubsub', async (original) => ({
  ...(await original<typeof import('@/lib/server/realtime/pubsub')>()),
  publish: vi.fn(),
  publishAsync: vi.fn(async () => {}),
}))

import {
  and,
  eq,
  conversations,
  conversationMessages,
  integrations,
  integrationDestinations,
  integrationEventMappings,
  integrationSyncOperations as operations,
  principal,
  settings,
  teams,
  ticketConversations,
  ticketExternalLinks,
  ticketStatuses,
  ticketTypes,
  tickets,
  user,
} from '@/lib/server/db'
import { encryptSecrets } from '@/lib/server/integrations/encryption'
import {
  mirrorDestinationEventMappings,
  setDestinationTicketIssues,
} from '@/lib/server/integrations/destination-admin'
import { integrationResolver } from '@/lib/server/events/resolvers/integration.resolver'
import { queueHookSync } from '@/lib/server/integrations/sync/hooks'
import { runIntegrationSync } from '@/lib/server/integrations/sync/worker'
import { syncTestJob } from '@/lib/server/integrations/sync/__tests__/job'
import { createIssueForTicket } from '@/lib/server/domains/tickets/ticket-external-links.service'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'
import type { Actor } from '@/lib/server/policy/types'
import type { HookJobData } from '@/lib/server/events/hook-job'
import type { DomainEvent } from '@/lib/server/events/envelope'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: integrationDestinations.id }).from(integrationDestinations).limit(0)
  },
})

const unique = () => randomUUID().slice(0, 8)

describe.skipIf(!fixture.available)('GitHub issues for new tickets (real DB)', () => {
  let created: { repo: string; body: Record<string, unknown> }[]

  beforeEach(async () => {
    await fixture.begin()
    created = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const match = /repos\/([^/]+\/[^/]+)\/issues$/.exec(String(input))
      if (!match || init?.method !== 'POST') throw new Error(`unexpected call: ${String(input)}`)
      created.push({ repo: match[1], body: JSON.parse(String(init.body)) })
      const number = created.length
      return Response.json(
        { number, html_url: `https://github.com/${match[1]}/issues/${number}` },
        { status: 201 }
      )
    })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await fixture.rollback()
  })
  afterAll(fixture.close)

  async function seed() {
    await testDb
      .insert(settings)
      .values({ name: 'Acme', slug: `acme-${unique()}`, createdAt: new Date() })
    const [status] = await testDb
      .insert(ticketStatuses)
      .values({
        name: 'Waiting on us',
        slug: `waiting_${unique()}`,
        category: 'open',
        position: 100,
        publicStage: 'received',
      })
      .returning()
    const [billing] = await testDb
      .insert(teams)
      .values({ name: `Billing ${unique()}` })
      .returning()
    const [platform] = await testDb
      .insert(teams)
      .values({ name: `Platform ${unique()}` })
      .returning()
    const [bug] = await testDb
      .insert(ticketTypes)
      .values({ name: 'Bug', slug: `bug_${unique()}`, category: 'customer' })
      .returning()
    const [question] = await testDb
      .insert(ticketTypes)
      .values({ name: 'Question', slug: `question_${unique()}`, category: 'customer' })
      .returning()
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
    const repos = await testDb
      .insert(integrationDestinations)
      .values(
        [
          { externalId: 'acme/api' },
          { externalId: 'acme/web' },
          { externalId: 'acme/off', enabled: false },
          { externalId: 'acme/reports', config: { direction: 'inbound' as const } },
        ].map((repo) => ({ integrationId: integration.id, kind: 'repo', ...repo }))
      )
      .returning()
    const repo = Object.fromEntries(repos.map((r) => [r.externalId, r]))
    return { status, billing, platform, bug, question, servicePrincipal, integration, repo }
  }
  type Seeded = Awaited<ReturnType<typeof seed>>

  async function agent(): Promise<Actor> {
    const [person] = await testDb
      .insert(user)
      .values({ name: 'Jane', email: `jane-${unique()}@example.test` })
      .returning()
    const [p] = await testDb
      .insert(principal)
      .values({ userId: person.id, type: 'user', role: 'admin', createdAt: new Date() })
      .returning()
    return {
      principalId: p.id,
      role: 'admin',
      principalType: 'user',
      segmentIds: new Set(),
      permissions: resolveActorPermissions('admin'),
    }
  }

  async function ticket(
    s: Seeded,
    over: Partial<typeof tickets.$inferInsert> = {}
  ): Promise<typeof tickets.$inferSelect> {
    const [row] = await testDb
      .insert(tickets)
      .values({
        type: 'customer',
        title: 'Export fails on large CSVs',
        statusId: s.status.id,
        priority: 'high',
        ...over,
      })
      .returning()
    return row
  }

  function ref(row: typeof tickets.$inferSelect) {
    return {
      id: row.id,
      number: row.number,
      type: row.type,
      ticketTypeId: row.ticketTypeId,
      priority: row.priority,
      assignedPrincipalId: row.assigneePrincipalId,
      assignedTeamId: row.assigneeTeamId,
    }
  }

  /** The event as the outbox hands it to the resolver. */
  function domainEvent(
    type: 'ticket.created' | 'ticket.assigned',
    row: typeof tickets.$inferSelect,
    actor: { type: 'user' | 'service'; id: string }
  ): DomainEvent {
    return {
      eventId: createId('event'),
      seq: 1n,
      type,
      entityType: 'ticket',
      entityId: row.id,
      actorType: actor.type,
      actorId: actor.id,
      payload:
        type === 'ticket.created'
          ? { ticket: ref(row) }
          : {
              ticket: ref(row),
              assignedPrincipalId: null,
              previousPrincipalId: null,
              assignedTeamId: row.assigneeTeamId,
              previousTeamId: null,
            },
      context: { depth: 0 },
      schemaVersion: 1,
      occurredAt: new Date(),
    }
  }

  /** Resolve the event and queue what the integration sink routes, as the relay does. */
  async function dispatch(
    type: 'ticket.created' | 'ticket.assigned',
    row: typeof tickets.$inferSelect,
    actor: { type: 'user' | 'service'; id: string }
  ) {
    const event = domainEvent(type, row, actor)
    const targets = await integrationResolver.resolve(event)
    const queued = []
    for (const target of targets) {
      const data: HookJobData = {
        hookType: target.type,
        event: {
          id: event.eventId,
          type,
          timestamp: new Date().toISOString(),
          actor: { type: actor.type, principalId: actor.id },
          data: event.payload,
        } as HookJobData['event'],
        target: target.target,
        config: target.config,
      }
      queued.push(await queueHookSync(data))
    }
    return { targets: targets.map((t) => (t.target as { channelId: string }).channelId), queued }
  }

  const someone = { type: 'user' as const, id: createId('principal') }

  async function run(operationId: string) {
    await runIntegrationSync(syncTestJob(operationId))
    return testDb.query.integrationSyncOperations.findFirst({
      where: eq(operations.id, operationId),
    })
  }

  async function links(ticketId: TicketId) {
    return testDb
      .select()
      .from(ticketExternalLinks)
      .where(eq(ticketExternalLinks.ticketId, ticketId))
  }

  it('opens one issue for a matching ticket, shared with the manual create', async () => {
    const s = await seed()
    await setDestinationTicketIssues(s.repo['acme/web'].id, {
      enabled: true,
      teamIds: [s.billing.id],
      ticketTypeIds: [],
    })
    const row = await ticket(s, { assigneeTeamId: s.billing.id })

    const { targets, queued } = await dispatch('ticket.created', row, someone)
    expect(targets).toEqual(['acme/web'])
    const op = await run(queued[0]!.id)
    expect(op?.state).toBe('succeeded')
    expect(created).toHaveLength(1)
    expect(created[0].repo).toBe('acme/web')
    expect(created[0].body.title).toBe('Export fails on large CSVs')
    expect(created[0].body.labels).toEqual(['priority:high'])
    expect(created[0].body.body).toContain(
      `<!-- quackback:ticket-issue ticketId=${row.id} integrationId=${s.integration.id} -->`
    )
    expect((await links(row.id)).map((l) => l.externalDisplayId)).toEqual(['acme/web#1'])

    // A teammate asking for the same issue gets the one already made.
    const manual = await createIssueForTicket(
      row.id,
      'github',
      await agent(),
      s.repo['acme/web'].id
    )
    expect(manual).toEqual({ operationId: queued[0]!.id, state: 'succeeded' })
    // A later qualifying event finds the issue linked and queues nothing.
    expect((await dispatch('ticket.assigned', row, someone)).queued).toEqual([null])
    expect(created).toHaveLength(1)
    expect(await testDb.select().from(operations)).toHaveLength(1)
  })

  it('shares one create with a teammate who asked first', async () => {
    const s = await seed()
    await setDestinationTicketIssues(s.repo['acme/api'].id, {
      enabled: true,
      teamIds: [],
      ticketTypeIds: [],
    })
    const row = await ticket(s)
    const manual = await createIssueForTicket(
      row.id,
      'github',
      await agent(),
      s.repo['acme/api'].id
    )
    // Still queued: the event lands on the teammate's operation, not a second one.
    const { queued } = await dispatch('ticket.created', row, someone)
    expect(queued[0]).toMatchObject({ id: manual.operationId, state: 'queued' })
    await run(manual.operationId)
    expect(created).toHaveLength(1)
    // Done and linked: nothing more is queued.
    expect((await dispatch('ticket.assigned', row, someone)).queued).toEqual([null])
    expect(await testDb.select().from(operations)).toHaveLength(1)
  })

  it('opens nothing for what the integration did, nor for a ticket from a GitHub issue', async () => {
    const s = await seed()
    await setDestinationTicketIssues(s.repo['acme/api'].id, {
      enabled: true,
      teamIds: [],
      ticketTypeIds: [],
    })
    const own = await ticket(s)
    const integrationActor = { type: 'service' as const, id: s.servicePrincipal }
    expect((await dispatch('ticket.created', own, integrationActor)).targets).toEqual([])
    // Even when the resolver's routing is bypassed, queueing applies the rule.
    const data = {
      hookType: 'github',
      event: {
        id: randomUUID(),
        type: 'ticket.created',
        timestamp: new Date().toISOString(),
        actor: { type: 'service', principalId: s.servicePrincipal },
        data: { ticket: ref(own) },
      },
      target: { channelId: 'acme/api' },
      config: { integrationId: s.integration.id },
    } as unknown as HookJobData
    expect(await queueHookSync(data)).toBeNull()

    // A ticket paired with a GitHub conversation came from an issue already.
    const fromIssue = await ticket(s)
    const [conversation] = await testDb
      .insert(conversations)
      .values({ visitorPrincipalId: s.servicePrincipal as PrincipalId, channel: 'github' })
      .returning()
    await testDb
      .insert(ticketConversations)
      .values({ ticketId: fromIssue.id, conversationId: conversation.id, ticketType: 'customer' })
    expect((await dispatch('ticket.assigned', fromIssue, someone)).queued).toEqual([null])

    expect(await testDb.select().from(operations)).toHaveLength(0)
  })

  it('opens the issue once a team set later makes the ticket match', async () => {
    const s = await seed()
    await setDestinationTicketIssues(s.repo['acme/api'].id, {
      enabled: true,
      teamIds: [s.billing.id],
      ticketTypeIds: [s.bug.id],
    })
    const row = await ticket(s, { ticketTypeId: s.bug.id })
    expect((await dispatch('ticket.created', row, someone)).targets).toEqual([])

    const [moved] = await testDb
      .update(tickets)
      .set({ assigneeTeamId: s.billing.id })
      .where(eq(tickets.id, row.id))
      .returning()
    const first = await dispatch('ticket.assigned', moved, someone)
    const second = await dispatch('ticket.assigned', moved, someone)
    expect(first.queued[0]?.id).toBeTruthy()
    expect(second.queued[0]?.id).toBe(first.queued[0]?.id)
    await run(first.queued[0]!.id)
    expect(created.map((c) => c.repo)).toEqual(['acme/api'])

    // A ticket of another type does not match.
    const question = await ticket(s, { assigneeTeamId: s.billing.id, ticketTypeId: s.question.id })
    expect((await dispatch('ticket.created', question, someone)).targets).toEqual([])
  })

  it('sends nothing to a switched-off or receive-only repository', async () => {
    const s = await seed()
    for (const name of ['acme/off', 'acme/reports'])
      await setDestinationTicketIssues(s.repo[name].id, {
        enabled: true,
        teamIds: [],
        ticketTypeIds: [],
      })
    const row = await ticket(s)
    expect((await dispatch('ticket.created', row, someone)).targets).toEqual([])
    for (const channelId of ['acme/off', 'acme/reports']) {
      const data = {
        hookType: 'github',
        event: {
          id: randomUUID(),
          type: 'ticket.created',
          timestamp: new Date().toISOString(),
          actor: { type: 'user', principalId: someone.id },
          data: { ticket: ref(row) },
        },
        target: { channelId },
        config: { integrationId: s.integration.id },
      } as unknown as HookJobData
      expect(await queueHookSync(data)).toBeNull()
    }
  })

  it('never opens one for a ticket opened before the repository opted in', async () => {
    const s = await seed()
    await setDestinationTicketIssues(s.repo['acme/api'].id, {
      enabled: true,
      teamIds: [],
      ticketTypeIds: [],
    })
    // The opt-in came after this ticket was opened.
    await testDb
      .update(integrationEventMappings)
      .set({ createdAt: new Date(Date.now() + 60_000) })
      .where(eq(integrationEventMappings.targetKey, s.repo['acme/api'].id))
    const row = await ticket(s)
    expect((await dispatch('ticket.created', row, someone)).queued).toEqual([null])
    expect((await dispatch('ticket.assigned', row, someone)).queued).toEqual([null])
    expect(await testDb.select().from(operations)).toHaveLength(0)
  })

  it('asks again before sending, and a later match resumes the set-aside create', async () => {
    const s = await seed()
    await setDestinationTicketIssues(s.repo['acme/api'].id, {
      enabled: true,
      teamIds: [s.billing.id],
      ticketTypeIds: [],
    })
    const row = await ticket(s, { assigneeTeamId: s.billing.id })
    const { queued } = await dispatch('ticket.created', row, someone)
    // Moved to another team before the worker got to it.
    await testDb
      .update(tickets)
      .set({ assigneeTeamId: s.platform.id })
      .where(eq(tickets.id, row.id))
    expect(await run(queued[0]!.id)).toMatchObject({
      state: 'cancelled',
      errorCode: 'source_unavailable',
    })
    expect(created).toHaveLength(0)

    const [back] = await testDb
      .update(tickets)
      .set({ assigneeTeamId: s.billing.id })
      .where(eq(tickets.id, row.id))
      .returning()
    const resumed = await dispatch('ticket.assigned', back, someone)
    expect(resumed.queued[0]).toMatchObject({ id: queued[0]!.id, state: 'queued' })
    // The repository switched off meanwhile: set aside again, nothing sent.
    await testDb
      .update(integrationDestinations)
      .set({ enabled: false })
      .where(eq(integrationDestinations.id, s.repo['acme/api'].id))
    expect((await run(queued[0]!.id))?.state).toBe('cancelled')
    expect(created).toHaveLength(0)
  })

  it('puts the customer-visible thread in the issue, never internal notes or their files', async () => {
    const s = await seed()
    await setDestinationTicketIssues(s.repo['acme/api'].id, {
      enabled: true,
      teamIds: [],
      ticketTypeIds: [],
    })
    const requester = await agent()
    const row = await ticket(s, { requesterPrincipalId: requester.principalId })
    const [conversation] = await testDb
      .insert(conversations)
      .values({ visitorPrincipalId: requester.principalId!, channel: 'email' })
      .returning()
    await testDb
      .insert(ticketConversations)
      .values({ ticketId: row.id, conversationId: conversation.id, ticketType: 'customer' })
    await testDb.insert(conversationMessages).values([
      {
        conversationId: conversation.id,
        principalId: requester.principalId,
        senderType: 'visitor',
        content: 'Exports stop at 10k rows.',
        attachments: [
          { url: '/api/files/shot.png', name: 'shot.png', contentType: 'image/png', size: 10 },
        ],
      },
      {
        ticketId: row.id,
        principalId: requester.principalId,
        senderType: 'agent',
        isInternal: true,
        content: 'PRIVATE: refund them.',
        attachments: [
          {
            url: '/api/files/secret.pdf',
            name: 'secret.pdf',
            contentType: 'application/pdf',
            size: 1,
          },
        ],
      },
    ])
    const { queued } = await dispatch('ticket.created', row, someone)
    await run(queued[0]!.id)
    const body = String(created[0].body.body)
    expect(body).toContain('Exports stop at 10k rows.')
    expect(body).toMatch(/!\[shot\.png\]\([^)]*\/api\/files\/shot\.png\)/)
    expect(body).not.toContain('PRIVATE')
    expect(body).not.toContain('secret.pdf')
    expect(body).not.toContain('jane-')
    expect(created[0].body.labels).toEqual(['priority:high', 'channel:email'])
  })

  it('keeps the opt-in apart from mirrored feedback mappings, and removes it when switched off', async () => {
    const s = await seed()
    const web = s.repo['acme/web']
    await setDestinationTicketIssues(web.id, {
      enabled: true,
      teamIds: [s.billing.id],
      ticketTypeIds: [],
    })
    const mine = () =>
      testDb
        .select({ eventType: integrationEventMappings.eventType })
        .from(integrationEventMappings)
        .where(
          and(
            eq(integrationEventMappings.integrationId, s.integration.id),
            eq(integrationEventMappings.targetKey, web.id)
          )
        )
    // The connection has no feedback mapping on: mirroring clears destination copies, not these.
    await mirrorDestinationEventMappings(s.integration.id)
    expect((await mine()).map((m) => m.eventType).sort()).toEqual([
      'ticket.assigned',
      'ticket.created',
    ])

    await expect(
      setDestinationTicketIssues(web.id, {
        enabled: true,
        teamIds: ['team_nope'],
        ticketTypeIds: [],
      })
    ).rejects.toThrow('Choose teams that exist')

    expect(
      await setDestinationTicketIssues(web.id, { enabled: false, teamIds: [], ticketTypeIds: [] })
    ).toEqual({ enabled: false, teamIds: [], ticketTypeIds: [] })
    expect(await mine()).toEqual([])
  })
})
