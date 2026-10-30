/**
 * Comments on a GitHub issue brought into the tickets linked to it, against a
 * real database. A signed `issue_comment` delivery is stored as a receipt;
 * its worker queues one operation per linked ticket, and each writes an
 * internal note or a public reply (the repository's `commentVisibility`) as
 * the integration's service principal, recorded in message_external_links.
 * Edits follow (an older one is superseded), deletions remove the message.
 *
 * Nothing comes in from a repository with comments off, switched off or
 * send-only, nor our own bot's comments or a body carrying our marker; a
 * marker naming a reply of ours restores that reply's missing record. A
 * ticket paired with the issue's inbox conversation is left to the channel.
 * What came in is never posted back. A comment of ours deleted on GitHub
 * retires its record and leaves the reply. A ticket's resync brings in the
 * issue's comments since it was linked and posts its replies since the
 * repository opted in, forward only. An issue that names a ticket it is not
 * linked to is proposed for linking in Sync history, once, and linked only
 * when a teammate confirms it.
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
vi.mock('@/lib/server/cache', () => ({
  cacheGet: vi.fn(async () => null),
  cacheSet: vi.fn(async () => {}),
  cacheDel: vi.fn(async () => {}),
  CACHE_KEYS: { INTEGRATION_MAPPINGS: 'mappings' },
}))
vi.mock('@/lib/server/config', async (original) => ({
  ...(await original<typeof import('@/lib/server/config')>()),
  getBaseUrl: () => 'https://help.acme.test',
}))
vi.mock('@/lib/server/realtime/pubsub', async (original) => ({
  ...(await original<typeof import('@/lib/server/realtime/pubsub')>()),
  publish: vi.fn(),
  publishAsync: vi.fn(async () => {}),
}))

import {
  and,
  eq,
  inArray,
  channelAccounts,
  conversationMessages,
  integrations,
  integrationDestinations,
  integrationSyncOperations as operations,
  messageExternalLinks,
  principal,
  settings,
  teams,
  ticketConversations,
  ticketExternalLinks,
  ticketStatuses,
  tickets,
  user,
  sql,
} from '@/lib/server/db'
import { encryptSecrets } from '@/lib/server/integrations/encryption'
import { getIntegration } from '@/lib/server/integrations'
import { syncScopeFor } from '@/lib/server/integrations/sync/identity'
import { queueInboundWebhook } from '@/lib/server/integrations/sync/inbound'
import { runIntegrationSync } from '@/lib/server/integrations/sync/worker'
import { syncTestJob } from '@/lib/server/integrations/sync/__tests__/job'
import { handleInboundWebhook } from '@/lib/server/integrations/inbound-webhook-handler'
import { upsertUserMapping } from '@/lib/server/integrations/user-mappings'
import { syncTicketIntegrations } from '@/lib/server/integrations/ticket-sync'
import { ticketCommentResolver } from '@/lib/server/events/resolvers/ticket-comment.resolver'
import { ticketCommentMarker } from '@/integrations/github/server/ticket-comment'
import { ticketIssueMarker } from '@/integrations/github/server/ticket-issue'
import { actOnSync, listSyncHistory } from '@/lib/server/integrations/sync/history'
import { ingestGitHubChannelEvent } from '@/lib/server/domains/conversation/conversation.github-inbound'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { NotFoundError } from '@/lib/shared/errors'
import type { DomainEvent } from '@/lib/server/events/envelope'
import type { Actor } from '@/lib/server/policy/types'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: messageExternalLinks.id }).from(messageExternalLinks).limit(0)
  },
})

const unique = () => randomUUID().slice(0, 8)
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000)
const ahead = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString()

type IntegrationRow = typeof integrations.$inferSelect
const IMPORT_KINDS = ['comment-import', 'comment-import-update', 'comment-import-delete']

describe.skipIf(!fixture.available)('GitHub comments into linked tickets (real DB)', () => {
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

  async function teammate(name: string, role: 'admin' | 'member' = 'admin') {
    const [person] = await testDb
      .insert(user)
      .values({ name, email: `${unique()}@example.test` })
      .returning()
    const [p] = await testDb
      .insert(principal)
      .values({ userId: person.id, type: 'user', role, displayName: name, createdAt: new Date() })
      .returning()
    return p.id as PrincipalId
  }

  async function seed(api: Record<string, unknown> = { commentVisibility: 'note' }) {
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
    const servicePrincipal = createId('principal')
    await testDb.insert(principal).values({
      id: servicePrincipal,
      type: 'service',
      role: 'member',
      displayName: 'GitHub',
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
    const [repo] = await testDb
      .insert(integrationDestinations)
      .values({
        integrationId: integration.id,
        kind: 'repo',
        externalId: 'acme/api',
        externalKey: '1',
        secrets: encryptSecrets({ webhookSecret: 'repo-secret' }),
        config: api,
      })
      .returning()
    await testDb.insert(integrationDestinations).values({
      integrationId: integration.id,
      kind: 'repo',
      externalId: 'acme/web',
      externalKey: '2',
      config: { commentVisibility: 'note' },
    })
    const agent = await teammate('Jane Doe')
    const requester = await teammate('Pat Customer', 'member')
    const ticket = async (title: string) =>
      (
        await testDb
          .insert(tickets)
          .values({
            type: 'customer',
            title,
            statusId: status.id,
            requesterPrincipalId: requester,
          })
          .returning()
      )[0]
    const link = async (ticketId: TicketId, repoName = 'acme/api', number = 7) =>
      (
        await testDb
          .insert(ticketExternalLinks)
          .values({
            ticketId,
            integrationId: integration.id,
            integrationType: 'github',
            externalId: String(number),
            externalDisplayId: `${repoName}#${number}`,
            externalUrl: `https://github.com/${repoName}/issues/${number}`,
            syncScope: syncScopeFor(integration, { channelId: repoName }, getIntegration('github')),
            createdAt: ago(60),
          })
          .returning()
      )[0]
    const first = await ticket('Export fails')
    const second = await ticket('Export fails too')
    const elsewhere = await ticket('Same number, other repository')
    const links = {
      first: await link(first.id),
      second: await link(second.id),
      elsewhere: await link(elsewhere.id, 'acme/web'),
    }
    return {
      integration,
      repo,
      servicePrincipal: servicePrincipal as PrincipalId,
      agent,
      requester,
      tickets: { first, second, elsewhere },
      links,
      ticket,
      link,
    }
  }
  type Seeded = Awaited<ReturnType<typeof seed>>

  function delivery(over: {
    action?: 'created' | 'edited' | 'deleted'
    id?: number
    body?: string
    login?: string
    userId?: number
    number?: number
    repo?: string
    createdAt?: string
    updatedAt?: string
  }) {
    const number = over.number ?? 7
    const repo = over.repo ?? 'acme/api'
    const createdAt = over.createdAt ?? ahead(1)
    return JSON.stringify({
      action: over.action ?? 'created',
      repository: { full_name: repo, id: repo === 'acme/api' ? 1 : 2 },
      sender: { login: over.login ?? 'jane-gh' },
      issue: { number, html_url: `https://github.com/${repo}/issues/${number}` },
      comment: {
        id: over.id ?? 555,
        body: over.body ?? 'Reproduced on **main**.',
        html_url: `https://github.com/${repo}/issues/${number}#issuecomment-${over.id ?? 555}`,
        user: { id: over.userId ?? 42, login: over.login ?? 'jane-gh' },
        created_at: createdAt,
        updated_at: over.updatedAt ?? createdAt,
      },
    })
  }

  const current = async (id: IntegrationRow['id']) =>
    (await testDb.query.integrations.findFirst({ where: eq(integrations.id, id) }))!

  async function run(operationId: string) {
    try {
      await runIntegrationSync(syncTestJob(operationId))
    } catch {
      // A retry is the job queue's to schedule; the operation records it.
    }
    return (await testDb.query.integrationSyncOperations.findFirst({
      where: eq(operations.id, operationId),
    }))!
  }

  /** Store a verified delivery as its receipt and run it, then every comment operation it queued. */
  async function receive(s: Seeded, body: string) {
    const receipt = (await queueInboundWebhook(
      await current(s.integration.id),
      body,
      randomUUID()
    ))!
    await run(receipt.id)
    const queued = await testDb.query.integrationSyncOperations.findMany({
      where: and(inArray(operations.kind, IMPORT_KINDS), eq(operations.state, 'queued')),
    })
    const done = []
    for (const op of queued) done.push(await run(op.id))
    return done
  }

  const messagesOf = (ticketId: TicketId) =>
    testDb.query.conversationMessages.findMany({
      where: eq(conversationMessages.ticketId, ticketId),
      orderBy: (m, { asc }) => [asc(m.createdAt)],
    })
  const recordsOf = (linkId: string) =>
    testDb.query.messageExternalLinks.findMany({
      where: eq(messageExternalLinks.ticketExternalLinkId, linkId as never),
    })
  const setRepo = (s: Seeded, config: Record<string, unknown>, enabled = true) =>
    testDb
      .update(integrationDestinations)
      .set({ config, enabled })
      .where(eq(integrationDestinations.id, s.repo.id))

  it('a signed comment becomes an internal note on every ticket linked to the issue', async () => {
    const s = await seed()
    const body = delivery({})
    const response = await handleInboundWebhook(
      new Request('https://tenant.example/api/integrations/github/webhook', {
        method: 'POST',
        headers: {
          'X-GitHub-Event': 'issue_comment',
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
    await run(receipt.id)
    const queued = await testDb.query.integrationSyncOperations.findMany({
      where: eq(operations.kind, 'comment-import'),
    })
    // Both tickets linked to acme/api#7; not the one linked to acme/web#7.
    expect(queued.map((op) => op.sourceId).sort()).toEqual(
      [s.tickets.first.id, s.tickets.second.id].sort()
    )
    for (const op of queued) expect((await run(op.id)).state).toBe('succeeded')

    for (const [ticket, link] of [
      [s.tickets.first, s.links.first],
      [s.tickets.second, s.links.second],
    ] as const) {
      const [note] = await messagesOf(ticket.id)
      expect(note).toMatchObject({
        isInternal: true,
        senderType: 'agent',
        principalId: s.servicePrincipal,
      })
      expect(note.content).toContain('GitHub comment from @jane-gh')
      expect(note.content).toContain('Reproduced on main.')
      expect(await recordsOf(link.id)).toMatchObject([
        { messageId: note.id, externalId: '555', direction: 'inbound', status: 'active' },
      ])
    }
    expect(await messagesOf(s.tickets.elsewhere.id)).toEqual([])
  })

  it("a public reply for 'reply' visibility, naming the matched teammate, never posted back", async () => {
    const s = await seed({ commentVisibility: 'reply', postRepliesAsComments: true })
    await upsertUserMapping({
      integrationId: s.integration.id,
      externalUserId: '42',
      externalLogin: 'jane-gh',
      principalId: s.agent,
    })
    const done = await receive(s, delivery({}))
    expect(done.map((op) => op.state)).toEqual(['succeeded', 'succeeded'])
    const [reply] = await messagesOf(s.tickets.first.id)
    expect(reply).toMatchObject({
      isInternal: false,
      senderType: 'agent',
      principalId: s.servicePrincipal,
    })
    // Posted as the integration, naming the teammate behind the account.
    expect(reply.content).toContain('GitHub comment from Jane Doe (@jane-gh)')

    // The reply's own event, written by the integration, routes nowhere back.
    const event: DomainEvent = {
      eventId: createId('event'),
      seq: 1n,
      type: 'ticket.replied',
      entityType: 'ticket',
      entityId: s.tickets.first.id,
      actorType: 'service',
      actorId: s.servicePrincipal,
      payload: { ticket: { id: s.tickets.first.id }, messageId: reply.id },
      context: { depth: 0 },
      schemaVersion: 1,
      occurredAt: new Date(),
    }
    expect(await ticketCommentResolver.resolve(event)).toEqual([])
    // Nor does a resync count it as a reply missing its comment.
    await testDb
      .update(integrationDestinations)
      .set({
        config: {
          commentVisibility: 'off',
          postRepliesAsComments: true,
          postRepliesAsCommentsSince: ago(120).toISOString(),
        },
      })
      .where(eq(integrationDestinations.id, s.repo.id))
    const admin = adminActor(s.agent)
    expect(await syncTicketIntegrations(s.tickets.first.id, admin)).toEqual({
      outbound: 0,
      inbound: 0,
    })
  })

  it('brings nothing in with comments off, from a switched-off or send-only repository', async () => {
    const s = await seed({ commentVisibility: 'off' })
    expect(await receive(s, delivery({ id: 1 }))).toEqual([])
    await setRepo(s, { commentVisibility: 'note' }, false)
    expect(await receive(s, delivery({ id: 2 }))).toEqual([])
    await setRepo(s, { commentVisibility: 'note', direction: 'outbound' })
    expect(await receive(s, delivery({ id: 3 }))).toEqual([])
    expect(await messagesOf(s.tickets.first.id)).toEqual([])
  })

  it("skips our bot's comments and marked bodies, restoring a reply's missing record", async () => {
    const s = await seed()
    expect(await receive(s, delivery({ id: 1, login: 'ACME-BOT' }))).toEqual([])
    expect(
      await receive(s, delivery({ id: 2, body: 'x <!-- quackback:ticket-issue ticketId=t -->' }))
    ).toEqual([])
    // A reply of ours whose comment was posted but whose record never was.
    const [reply] = await testDb
      .insert(conversationMessages)
      .values({
        ticketId: s.tickets.first.id,
        principalId: s.agent,
        senderType: 'agent',
        content: 'Fixed.',
      })
      .returning()
    const body = `_Quackback reply by Jane Doe_\n\nFixed.\n\n${ticketCommentMarker(reply.id, s.integration.id)}`
    expect(await receive(s, delivery({ id: 3, login: 'acme-bot', body }))).toEqual([])
    expect(await recordsOf(s.links.first.id)).toMatchObject([
      { messageId: reply.id, externalId: '3', direction: 'outbound', status: 'active' },
    ])
    // A marker naming another connection restores nothing.
    const other = `${ticketCommentMarker(reply.id, createId('integration'))}`
    await receive(s, delivery({ id: 4, login: 'acme-bot', body: other }))
    expect(await recordsOf(s.links.first.id)).toHaveLength(1)
    expect((await messagesOf(s.tickets.first.id)).map((m) => m.id)).toEqual([reply.id])
  })

  it('leaves a ticket paired with the issue inbox conversation to the channel', async () => {
    const s = await seed({ commentVisibility: 'note', inboundMode: 'tickets' })
    const [team] = await testDb
      .insert(teams)
      .values({ name: `Inbox ${unique()}`, isDefault: true })
      .returning()
    await testDb.insert(channelAccounts).values({
      owningTeamId: team.id as TeamId,
      channel: 'github',
      role: 'connection',
      config: {},
    })
    await ingestGitHubChannelEvent({
      body: JSON.stringify({
        action: 'opened',
        repository: { full_name: 'acme/api', id: 1 },
        sender: { login: 'cust' },
        issue: {
          number: 9,
          title: 'Export fails',
          body: 'Steps.',
          html_url: 'https://github.com/acme/api/issues/9',
          updated_at: new Date().toISOString(),
          user: { id: 5, login: 'cust' },
        },
      }),
      eventName: 'issues',
      integration: await current(s.integration.id),
      destination: s.repo,
    })
    const [pair] = await testDb
      .select({ ticketId: ticketConversations.ticketId })
      .from(ticketConversations)
    // The paired ticket, and another, both linked to the inbox's issue.
    await s.link(pair.ticketId, 'acme/api', 9)
    await s.link(s.tickets.first.id, 'acme/api', 9)
    expect(await receive(s, delivery({ number: 9 }))).toEqual([])
    expect(await messagesOf(s.tickets.first.id)).toEqual([])
  })

  it('a redelivered comment, or one a resync reads again, comes in once', async () => {
    const s = await seed()
    const body = delivery({})
    await receive(s, body)
    expect(await receive(s, body)).toEqual([])
    vi.mocked(fetch).mockImplementation(async () => Response.json([JSON.parse(body).comment]))
    expect(await syncTicketIntegrations(s.tickets.first.id, adminActor(s.agent))).toEqual({
      outbound: 0,
      inbound: 0,
    })
    expect(await messagesOf(s.tickets.first.id)).toHaveLength(1)
    expect(await recordsOf(s.links.first.id)).toHaveLength(1)
  })

  it('follows an edit, and supersedes one older than the version shown', async () => {
    const s = await seed()
    const createdAt = ahead(1)
    await receive(s, delivery({ createdAt }))
    const edited = ahead(60)
    const done = await receive(
      s,
      delivery({ action: 'edited', createdAt, updatedAt: edited, body: 'Fixed on **main**.' })
    )
    expect(done.map((op) => op.state)).toEqual(['succeeded', 'succeeded'])
    const [note] = await messagesOf(s.tickets.first.id)
    expect(note.content).toContain('Fixed on main.')
    expect(note.editedAt).not.toBeNull()
    expect((await recordsOf(s.links.first.id))[0].remoteVersion).toBe(edited)

    const stale = await receive(
      s,
      delivery({ action: 'edited', createdAt, updatedAt: ahead(30), body: 'Old words.' })
    )
    expect(stale.map((op) => op.state)).toEqual(['superseded', 'superseded'])
    expect((await messagesOf(s.tickets.first.id))[0].content).toContain('Fixed on main.')
  })

  it('a deleted comment removes its message and marks the record; a late create stays out', async () => {
    const s = await seed()
    await receive(s, delivery({}))
    const done = await receive(s, delivery({ action: 'deleted' }))
    expect(done.map((op) => op.state)).toEqual(['succeeded', 'succeeded'])
    const [note] = await testDb.query.conversationMessages.findMany({
      where: eq(conversationMessages.ticketId, s.tickets.first.id),
    })
    expect(note.deletedAt).not.toBeNull()
    expect(note.deletedByPrincipalId).toBe(s.servicePrincipal)
    expect((await recordsOf(s.links.first.id))[0].status).toBe('deleted')

    // Deleted before its creation was processed: the create is superseded.
    await receive(s, delivery({ id: 777, action: 'deleted' }))
    const late = await receive(s, delivery({ id: 777 }))
    expect(late.map((op) => op.state)).toEqual(['superseded', 'superseded'])
  })

  it('a resync brings in comments since the link and posts replies since the opt-in, forward only', async () => {
    const s = await seed({
      commentVisibility: 'note',
      postRepliesAsComments: true,
      postRepliesAsCommentsSince: ago(30).toISOString(),
    })
    // Sync started before everything here; only the link and the opt-in bound the resync.
    await testDb.execute(
      sql`UPDATE integration_sync_start SET started_at = ${ago(24 * 60).toISOString()}::timestamptz`
    )
    const ticketId = s.tickets.first.id
    const reply = async (minutesAgo: number, over: Record<string, unknown> = {}) =>
      (
        await testDb
          .insert(conversationMessages)
          .values({
            ticketId,
            principalId: s.agent,
            senderType: 'agent',
            content: `Reply ${minutesAgo}`,
            createdAt: ago(minutesAgo),
            ...over,
          })
          .returning()
      )[0]
    await reply(45) // before the opt-in
    const fresh = await reply(10)
    await reply(9, { isInternal: true })
    await reply(8, { principalId: s.servicePrincipal }) // brought in from the issue
    const posted = await reply(7)
    await testDb.insert(messageExternalLinks).values({
      messageId: posted.id,
      ticketExternalLinkId: s.links.first.id,
      integrationId: s.integration.id,
      syncScope: s.links.first.syncScope,
      externalId: '900',
      direction: 'outbound',
    })
    const unrecorded = await reply(50) // ours, posted before the opt-in, record lost

    const comment = (id: number, minutesAgo: number, over: Record<string, unknown> = {}) => ({
      id,
      body: `Comment ${id}`,
      html_url: `https://github.com/acme/api/issues/7#issuecomment-${id}`,
      user: { id: 42, login: 'jane-gh' },
      created_at: ago(minutesAgo).toISOString(),
      updated_at: ago(minutesAgo).toISOString(),
      ...over,
    })
    const remote = [
      comment(1, 120), // before the link
      comment(2, 5),
      comment(3, 4, { user: { id: 1, login: 'acme-bot' } }),
      comment(4, 3, {
        user: { id: 1, login: 'acme-bot' },
        body: ticketCommentMarker(unrecorded.id, s.integration.id),
      }),
    ]
    const requested: string[] = []
    vi.mocked(fetch).mockImplementation(async (input) => {
      requested.push(String(input))
      return Response.json(remote)
    })

    expect(await syncTicketIntegrations(ticketId, adminActor(s.agent))).toEqual({
      outbound: 1,
      inbound: 1,
    })
    const url = new URL(requested[0])
    expect(url.pathname).toBe('/repos/acme/api/issues/7/comments')
    expect(url.searchParams.get('since')).toBe(s.links.first.createdAt.toISOString())

    const out = await testDb.query.integrationSyncOperations.findMany({
      where: eq(operations.kind, 'comment'),
    })
    expect(out.map((op) => op.sourceId)).toEqual([fresh.id])
    expect(out[0].requestedBy).toBe(s.agent)
    const into = await testDb.query.integrationSyncOperations.findMany({
      where: eq(operations.kind, 'comment-import'),
    })
    expect(into).toMatchObject([{ sourceId: ticketId, remoteId: '2', state: 'queued' }])
    expect(await recordsOf(s.links.first.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          messageId: unrecorded.id,
          externalId: '4',
          direction: 'outbound',
        }),
      ])
    )
    expect((await run(into[0].id)).state).toBe('succeeded')
    expect((await messagesOf(ticketId)).at(-1)?.content).toContain('Comment 2')

    // The second ticket on the same issue is its own resync's to bring in.
    expect(await messagesOf(s.tickets.second.id)).toEqual([])
  })

  it('a resync is refused for a ticket the caller cannot see', async () => {
    const s = await seed()
    const outsider: Actor = {
      principalId: await teammate('Outsider', 'member'),
      role: 'member',
      principalType: 'user',
      segmentIds: new Set(),
      permissions: new Set([PERMISSIONS.TICKET_ASSIGN]),
    }
    await expect(syncTicketIntegrations(s.tickets.first.id, outsider)).rejects.toBeInstanceOf(
      NotFoundError
    )
  })

  it('a comment of ours deleted on GitHub retires its record and leaves the reply', async () => {
    const s = await seed()
    const [reply] = await testDb
      .insert(conversationMessages)
      .values({
        ticketId: s.tickets.first.id,
        principalId: s.agent,
        senderType: 'agent',
        content: 'Fixed.',
      })
      .returning()
    await testDb.insert(messageExternalLinks).values({
      messageId: reply.id,
      ticketExternalLinkId: s.links.first.id,
      integrationId: s.integration.id,
      syncScope: s.links.first.syncScope,
      externalId: '901',
      direction: 'outbound',
    })
    const body = `_Quackback reply by Jane Doe_\n\nFixed.\n\n${ticketCommentMarker(reply.id, s.integration.id)}`
    expect(
      await receive(s, delivery({ id: 901, action: 'deleted', login: 'acme-bot', body }))
    ).toEqual([])
    expect(await recordsOf(s.links.first.id)).toMatchObject([
      { messageId: reply.id, externalId: '901', direction: 'outbound', status: 'deleted' },
    ])
    const [kept] = await messagesOf(s.tickets.first.id)
    expect(kept).toMatchObject({ id: reply.id, deletedAt: null })
  })

  /** An `issues` delivery about issue #n, whose body is `body`. */
  function issueDelivery(number: number, body: string, action = 'edited') {
    return JSON.stringify({
      action,
      repository: { full_name: 'acme/api', id: 1 },
      sender: { login: 'maintainer' },
      issue: {
        number,
        title: 'Export fails',
        body,
        html_url: `https://github.com/acme/api/issues/${number}`,
        updated_at: ahead(1),
      },
    })
  }
  const relinks = () =>
    testDb.query.integrationSyncOperations.findMany({ where: eq(operations.kind, 'relink') })

  it('an unlinked issue naming a ticket is proposed once, and linked only when a teammate confirms', async () => {
    const s = await seed()
    const ticketId = s.tickets.first.id
    const issueBody = `Steps.\n\n${ticketIssueMarker(ticketId, s.integration.id)}`
    await receive(s, issueDelivery(12, issueBody))
    // A busy issue: its comments and further edits propose nothing more.
    const comment = JSON.parse(delivery({ id: 3, number: 12 }))
    comment.issue.body = issueBody
    await receive(s, JSON.stringify(comment))
    await receive(s, issueDelivery(12, `${issueBody}\n\nMore steps.`))
    const [item, ...more] = await relinks()
    expect(more).toEqual([])
    expect(item).toMatchObject({
      direction: 'inbound',
      sourceType: 'ticket',
      sourceId: ticketId,
      remoteId: '12',
      state: 'conflict',
      errorCode: 'unlinked_remote',
    })
    const linkedTo12 = () =>
      testDb.query.ticketExternalLinks.findMany({
        where: and(
          eq(ticketExternalLinks.ticketId, ticketId),
          eq(ticketExternalLinks.externalId, '12')
        ),
      })
    expect(await linkedTo12()).toEqual([])

    const admin = manager(s.agent)
    const history = await listSyncHistory({ provider: 'github', filter: 'attention' }, admin)
    expect(history.items.find((i) => i.id === item.id)).toMatchObject({
      kind: 'relink',
      remoteDisplayId: 'acme/api#12',
      actions: ['link_existing', 'cancel'],
    })

    vi.mocked(fetch).mockImplementation(async () =>
      Response.json({
        number: 12,
        title: 'Export fails',
        body: issueBody,
        html_url: 'https://github.com/acme/api/issues/12',
        updated_at: new Date().toISOString(),
      })
    )
    await actOnSync(
      {
        id: item.id,
        version: item.version,
        actionId: randomUUID(),
        action: 'link_existing',
        reference: '12',
        expectedRemoteId: '12',
      },
      admin
    )
    const [link] = await linkedTo12()
    expect(link).toMatchObject({
      status: 'active',
      externalDisplayId: 'acme/api#12',
      syncScope: s.links.first.syncScope,
    })
    expect((await relinks())[0].state).toBe('succeeded')
  })

  it('a link to the ticket in Quackback proposes it too; other connections, linked issues and pending creates do not', async () => {
    const s = await seed()
    const ticketId = s.tickets.second.id
    await receive(
      s,
      issueDelivery(13, `See [the ticket](https://help.acme.test/admin/inbox?i=${ticketId}).`)
    )
    expect(await relinks()).toMatchObject([{ sourceId: ticketId, remoteId: '13' }])

    // Another connection's marker, a link to another site, an issue already linked.
    await receive(s, issueDelivery(14, ticketIssueMarker(ticketId, createId('integration'))))
    await receive(s, issueDelivery(15, `https://elsewhere.test/admin/inbox?i=${ticketId}`))
    await receive(s, issueDelivery(7, ticketIssueMarker(ticketId, s.integration.id)))
    // An issue whose create for this ticket is still settling links itself.
    const { queueSyncOperation } = await import('@/lib/server/integrations/sync/ledger')
    const { installationIdentity, syncDestination, syncOperationKey } =
      await import('@/lib/server/integrations/sync/identity')
    const integration = await current(s.integration.id)
    const destination = syncDestination(
      { channelId: 'acme/api' },
      integration.config as Record<string, unknown>,
      getIntegration('github')
    )
    const installation = installationIdentity(integration)
    await queueSyncOperation({
      operationKey: syncOperationKey({
        installation,
        kind: 'create',
        sourceType: 'ticket',
        sourceId: s.tickets.elsewhere.id,
        destination,
      }),
      integrationId: integration.id,
      installation,
      provider: 'github',
      direction: 'outbound',
      kind: 'create',
      sourceType: 'ticket',
      sourceId: s.tickets.elsewhere.id,
      destination,
      state: 'uncertain',
      payload: { executor: 'ticket-create', data: { target: { channelId: 'acme/api' } } },
    })
    await receive(s, issueDelivery(16, ticketIssueMarker(s.tickets.elsewhere.id, integration.id)))
    expect((await relinks()).map((op) => op.remoteId)).toEqual(['13'])
  })

  function manager(principalId: PrincipalId): Actor {
    return {
      principalId,
      role: 'admin',
      principalType: 'user',
      segmentIds: new Set(),
      permissions: new Set([
        PERMISSIONS.INTEGRATION_MANAGE,
        PERMISSIONS.INTEGRATION_VIEW,
        PERMISSIONS.TICKET_VIEW,
        PERMISSIONS.TICKET_VIEW_ALL,
      ]),
    }
  }

  function adminActor(principalId: PrincipalId): Actor {
    return {
      principalId,
      role: 'admin',
      principalType: 'user',
      segmentIds: new Set(),
      permissions: new Set([PERMISSIONS.TICKET_ASSIGN, PERMISSIONS.TICKET_VIEW_ALL]),
    }
  }
})
