/**
 * GitHub issue assignees onto tickets, against a real database. A signed
 * `issues.assigned` delivery is stored as a receipt; its worker queues one
 * `assignee` operation per linked ticket, and each operation assigns the
 * ticket to the matched teammate as the integration's service principal.
 * Linked tickets are the one paired with the issue's Inbox conversation
 * (tickets mode) and those linked to the issue on that repository.
 * Unmatched accounts, a repository with assignee sync off, a send-only
 * repository and our own bot change nothing; `unassigned` clears only the
 * teammate it names and keeps the team; an older delivery processed after a
 * newer one is superseded.
 */
import { beforeEach, afterEach, afterAll, describe, it, expect, vi } from 'vitest'
import { createHmac, randomUUID } from 'node:crypto'
import { createId, type PrincipalId, type TeamId, type TicketId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/secret-key', () => ({
  activeSecretKey: () => 'integration-sync-review-key-32-characters-only',
}))
vi.mock('@/lib/server/realtime/pubsub', async (original) => ({
  ...(await original<typeof import('@/lib/server/realtime/pubsub')>()),
  publish: vi.fn(),
  publishAsync: vi.fn(async () => {}),
}))

import {
  and,
  eq,
  channelAccounts,
  integrations,
  integrationDestinations,
  integrationSyncOperations as operations,
  principal,
  settings,
  teams,
  ticketConversations,
  ticketExternalLinks,
  tickets,
  user,
} from '@/lib/server/db'
import { encryptSecrets } from '@/lib/server/integrations/encryption'
import { getIntegration } from '@/lib/server/integrations'
import { syncScopeFor } from '@/lib/server/integrations/sync/identity'
import { queueInboundWebhook } from '@/lib/server/integrations/sync/inbound'
import { runIntegrationSync } from '@/lib/server/integrations/sync/worker'
import { syncTestJob } from '@/lib/server/integrations/sync/__tests__/job'
import { handleInboundWebhook } from '@/lib/server/integrations/inbound-webhook-handler'
import { upsertUserMapping } from '@/lib/server/integrations/user-mappings'
import { boundedServiceActor } from '@/lib/server/policy/service-actor'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { ingestGitHubChannelEvent } from '@/lib/server/domains/conversation/conversation.github-inbound'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: integrationDestinations.id }).from(integrationDestinations).limit(0)
  },
})

type IntegrationRow = typeof integrations.$inferSelect
type RepositoryRow = typeof integrationDestinations.$inferSelect

describe.skipIf(!fixture.available)('GitHub issue assignees onto tickets (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      throw new Error(`unexpected GitHub call: ${String(input)}`)
    })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await fixture.rollback()
  })
  afterAll(fixture.close)

  async function teammate(name: string) {
    const [row] = await testDb
      .insert(user)
      .values({ name, email: `${name.toLowerCase()}-${createId('user')}@example.test` })
      .returning()
    const [p] = await testDb
      .insert(principal)
      .values({
        userId: row.id,
        type: 'user',
        role: 'member',
        displayName: name,
        createdAt: new Date(),
      })
      .returning()
    return p.id as PrincipalId
  }

  async function seed(repositoryConfig: Record<string, unknown> = {}) {
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
        externalKey: '1',
        secrets: encryptSecrets({ webhookSecret: 'repo-secret' }),
        config: { inboundMode: 'tickets', assigneeSync: true, ...repositoryConfig },
      })
      .returning()
    const jane = await teammate('Jane')
    const ravi = await teammate('Ravi')
    await upsertUserMapping({
      integrationId: integration.id,
      externalUserId: '42',
      externalLogin: 'jane-gh',
      principalId: jane,
    })
    await upsertUserMapping({
      integrationId: integration.id,
      externalUserId: '43',
      externalLogin: 'ravi-gh',
      principalId: ravi,
    })
    return { integration, repository, servicePrincipal, jane, ravi, team }
  }

  /** The ticket paired with issue #n's Inbox conversation, opened the way tickets mode does. */
  async function pairedTicket(
    integration: IntegrationRow,
    repository: RepositoryRow,
    number = 7
  ): Promise<TicketId> {
    await ingestGitHubChannelEvent({
      body: JSON.stringify({
        action: 'opened',
        repository: { full_name: 'acme/api', id: 1 },
        sender: { login: 'cust' },
        issue: {
          number,
          title: 'Export fails',
          body: 'Steps.',
          html_url: `https://github.com/acme/api/issues/${number}`,
          updated_at: new Date().toISOString(),
          user: { id: 5, login: 'cust' },
        },
      }),
      eventName: 'issues',
      integration,
      destination: repository,
    })
    const [pair] = await testDb
      .select({ ticketId: ticketConversations.ticketId })
      .from(ticketConversations)
    return pair.ticketId
  }

  /** A ticket linked to issue #n on a repository, as linking from the ticket panel stores it. */
  async function trackedTicket(
    integration: IntegrationRow,
    servicePrincipal: string,
    repo = 'acme/api',
    number = 7
  ): Promise<TicketId> {
    const { createTicketCore } = await import('@/lib/server/domains/tickets/ticket-intake.service')
    const ticket = await createTicketCore(
      { type: 'customer', title: `Tracked ${repo}#${number}` },
      boundedServiceActor(new Set([PERMISSIONS.TICKET_CREATE]), servicePrincipal as PrincipalId)
    )
    await testDb.insert(ticketExternalLinks).values({
      ticketId: ticket.id,
      integrationId: integration.id,
      integrationType: 'github',
      externalId: String(number),
      externalDisplayId: `${repo}#${number}`,
      externalUrl: `https://github.com/${repo}/issues/${number}`,
      syncScope: syncScopeFor(integration, { channelId: repo }, getIntegration('github')),
    })
    return ticket.id
  }

  function assignment(over: {
    action?: 'assigned' | 'unassigned'
    assignee?: { id?: number; login: string }
    sender?: string
    number?: number
    updatedAt?: string
    repo?: string
  }) {
    const number = over.number ?? 7
    return JSON.stringify({
      action: over.action ?? 'assigned',
      assignee: over.assignee ?? { id: 42, login: 'jane-gh' },
      sender: { login: over.sender ?? 'maintainer' },
      repository: { full_name: over.repo ?? 'acme/api', id: 1 },
      issue: {
        number,
        html_url: `https://github.com/acme/api/issues/${number}`,
        updated_at: over.updatedAt ?? new Date(Date.now() + 1000).toISOString(),
      },
    })
  }

  const current = async (id: IntegrationRow['id']) =>
    (await testDb.query.integrations.findFirst({ where: eq(integrations.id, id) }))!

  /** Store a verified delivery as its receipt and run it, then run every assignee operation it queued. */
  async function receive(integration: IntegrationRow, body: string) {
    const receipt = (await queueInboundWebhook(await current(integration.id), body, randomUUID()))!
    await runIntegrationSync(syncTestJob(receipt.id))
    const queued = await testDb.query.integrationSyncOperations.findMany({
      where: and(eq(operations.kind, 'assignee'), eq(operations.state, 'queued')),
    })
    for (const op of queued) await runIntegrationSync(syncTestJob(op.id))
    return queued
  }

  const ticketOf = async (id: TicketId) =>
    (await testDb.query.tickets.findFirst({ where: eq(tickets.id, id) }))!

  it('a signed assignment assigns the paired and the tracked ticket as the integration', async () => {
    const { integration, repository, servicePrincipal, jane } = await seed()
    const paired = await pairedTicket(integration, repository)
    const tracked = await trackedTicket(integration, servicePrincipal)
    // Linked to the same number on another repository: not this issue.
    const elsewhere = await trackedTicket(integration, servicePrincipal, 'acme/other')

    const body = assignment({})
    const response = await handleInboundWebhook(
      new Request('https://tenant.example/api/integrations/github/webhook', {
        method: 'POST',
        headers: {
          'X-GitHub-Event': 'issues',
          'X-Hub-Signature-256': `sha256=${createHmac('sha256', 'repo-secret').update(body).digest('hex')}`,
        },
        body,
      }),
      'github'
    )
    expect(response.status).toBe(200)
    const [receipt] = await testDb.query.integrationSyncOperations.findMany({
      where: eq(operations.kind, 'receive-webhook'),
    })
    await runIntegrationSync(syncTestJob(receipt.id))
    const queued = await testDb.query.integrationSyncOperations.findMany({
      where: eq(operations.kind, 'assignee'),
    })
    expect(queued.map((op) => op.sourceId).sort()).toEqual([paired, tracked].sort())
    for (const op of queued) await runIntegrationSync(syncTestJob(op.id))

    expect((await ticketOf(paired)).assigneePrincipalId).toBe(jane)
    expect((await ticketOf(tracked)).assigneePrincipalId).toBe(jane)
    expect((await ticketOf(elsewhere)).assigneePrincipalId).toBeNull()
    const done = await testDb.query.integrationSyncOperations.findMany({
      where: eq(operations.kind, 'assignee'),
    })
    expect(done.map((op) => op.state)).toEqual(['succeeded', 'succeeded'])
    expect(done[0].result).toMatchObject({ externalDisplayId: 'acme/api#7', changed: true })

    // The assignment is the integration's own, as the activity records it.
    const { ticketActivity } = await import('@/lib/server/db')
    const activity = await testDb.query.ticketActivity.findMany({
      where: and(eq(ticketActivity.ticketId, paired), eq(ticketActivity.type, 'ticket.assigned')),
    })
    expect(activity.map((row) => row.principalId)).toContain(servicePrincipal)
  })

  it('an account matched by login alone, or not matched at all', async () => {
    const { integration, repository, ravi } = await seed()
    const paired = await pairedTicket(integration, repository)
    expect(
      await receive(integration, assignment({ assignee: { id: 99, login: 'stranger' } }))
    ).toEqual([])
    expect((await ticketOf(paired)).assigneePrincipalId).toBeNull()
    // A delivery without the account's id falls back to its login.
    await receive(integration, assignment({ assignee: { login: 'RAVI-GH' } }))
    expect((await ticketOf(paired)).assigneePrincipalId).toBe(ravi)
  })

  it('unassigning clears only the teammate it names, and keeps the team', async () => {
    const { integration, repository, jane, team } = await seed()
    const paired = await pairedTicket(integration, repository)
    await testDb
      .update(tickets)
      .set({ assigneePrincipalId: jane, assigneeTeamId: team.id })
      .where(eq(tickets.id, paired))

    await receive(
      integration,
      assignment({ action: 'unassigned', assignee: { id: 43, login: 'ravi-gh' } })
    )
    expect(await ticketOf(paired)).toMatchObject({ assigneePrincipalId: jane })

    await receive(integration, assignment({ action: 'unassigned' }))
    expect(await ticketOf(paired)).toMatchObject({
      assigneePrincipalId: null,
      assigneeTeamId: team.id,
    })
  })

  it('a repository with assignee sync off, or our own bot, changes nothing', async () => {
    const { integration, repository } = await seed({ assigneeSync: false })
    const paired = await pairedTicket(integration, repository)
    expect(await receive(integration, assignment({}))).toEqual([])

    await testDb
      .update(integrationDestinations)
      .set({ config: { inboundMode: 'tickets', assigneeSync: true } })
      .where(eq(integrationDestinations.id, repository.id))
    expect(await receive(integration, assignment({ sender: 'ACME-BOT' }))).toEqual([])
    expect((await ticketOf(paired)).assigneePrincipalId).toBeNull()
  })

  it('a send-only repository is acknowledged and never read', async () => {
    const { integration, repository } = await seed()
    const paired = await pairedTicket(integration, repository)
    await testDb
      .update(integrationDestinations)
      .set({ config: { inboundMode: 'tickets', assigneeSync: true, direction: 'outbound' } })
      .where(eq(integrationDestinations.id, repository.id))
    const body = assignment({})
    const response = await handleInboundWebhook(
      new Request('https://tenant.example/api/integrations/github/webhook', {
        method: 'POST',
        headers: {
          'X-GitHub-Event': 'issues',
          'X-Hub-Signature-256': `sha256=${createHmac('sha256', 'repo-secret').update(body).digest('hex')}`,
        },
        body,
      }),
      'github'
    )
    expect(response.status).toBe(200)
    expect(await testDb.query.integrationSyncOperations.findMany()).toEqual([])
    // A receipt stored before the repository became send-only queues nothing either.
    expect(await receive(integration, body)).toEqual([])
    expect((await ticketOf(paired)).assigneePrincipalId).toBeNull()
  })

  it('an older delivery processed after a newer one is superseded', async () => {
    const { integration, repository, ravi } = await seed()
    const paired = await pairedTicket(integration, repository)
    const later = new Date(Date.now() + 60_000).toISOString()
    const earlier = new Date(Date.now() + 30_000).toISOString()
    await receive(
      integration,
      assignment({ assignee: { id: 43, login: 'ravi-gh' }, updatedAt: later })
    )
    await receive(integration, assignment({ updatedAt: earlier }))
    expect((await ticketOf(paired)).assigneePrincipalId).toBe(ravi)
    const states = (
      await testDb.query.integrationSyncOperations.findMany({
        where: eq(operations.kind, 'assignee'),
      })
    ).map((op) => op.state)
    expect(states.sort()).toEqual(['succeeded', 'superseded'])
  })

  it('assignee sync switched off before the operation runs leaves the ticket alone', async () => {
    const { integration, repository } = await seed()
    const paired = await pairedTicket(integration, repository)
    const receipt = (await queueInboundWebhook(
      await current(integration.id),
      assignment({}),
      randomUUID()
    ))!
    await runIntegrationSync(syncTestJob(receipt.id))
    await testDb
      .update(integrationDestinations)
      .set({ config: { inboundMode: 'tickets', assigneeSync: false } })
      .where(eq(integrationDestinations.id, repository.id))
    const [op] = await testDb.query.integrationSyncOperations.findMany({
      where: eq(operations.kind, 'assignee'),
    })
    await runIntegrationSync(syncTestJob(op.id))
    expect((await ticketOf(paired)).assigneePrincipalId).toBeNull()
    expect(
      (await testDb.query.integrationSyncOperations.findFirst({ where: eq(operations.id, op.id) }))!
        .state
    ).toBe('cancelled')
  })
})
