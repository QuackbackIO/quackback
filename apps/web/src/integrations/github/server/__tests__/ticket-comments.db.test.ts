/**
 * A linked ticket's public replies as comments on its GitHub issues, against
 * a real database. The ticket-comment resolver routes a reply event to each
 * active link, the ledger queues one comment per reply and linked issue in a
 * repository that switched "Replies as comments" on, and the worker posts it
 * and records it in message_external_links. Edits and file changes rewrite
 * that comment; deleting the reply deletes it.
 *
 * Nothing is posted to a repository that did not opt in, is switched off or
 * only receives; nothing for an internal note or its files; nothing the
 * integration itself wrote; and nothing for a ticket paired with a GitHub
 * inbox conversation, whose replies reach the issue through the channel.
 */
import { beforeEach, afterEach, afterAll, describe, it, expect, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createId, type PrincipalId } from '@quackback/ids'
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
  eq,
  conversations,
  conversationMessages,
  integrations,
  integrationDestinations,
  integrationSyncOperations as operations,
  messageExternalLinks,
  principal,
  settings,
  ticketConversations,
  ticketExternalLinks,
  ticketStatuses,
  tickets,
  user,
  type ConversationAttachment,
} from '@/lib/server/db'
import { encryptSecrets } from '@/lib/server/integrations/encryption'
import { getIntegration } from '@/lib/server/integrations'
import { syncScopeFor } from '@/lib/server/integrations/sync/identity'
import { ticketCommentResolver } from '@/lib/server/events/resolvers/ticket-comment.resolver'
import { queueHookSync } from '@/lib/server/integrations/sync/hooks'
import { runIntegrationSync } from '@/lib/server/integrations/sync/worker'
import { listSyncHistory } from '@/lib/server/integrations/sync/history'
import { syncTestJob } from '@/lib/server/integrations/sync/__tests__/job'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'
import { SYNC_KIND_LABELS } from '@/lib/shared/integration-sync'
import type { HookJobData } from '@/lib/server/events/hook-job'
import type { DomainEvent } from '@/lib/server/events/envelope'
import type { Actor } from '@/lib/server/policy/types'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: messageExternalLinks.id }).from(messageExternalLinks).limit(0)
  },
})

const unique = () => randomUUID().slice(0, 8)

type Call = { method: string; path: string; body?: string }
type Reply = (call: Call) => Response | undefined

describe.skipIf(!fixture.available)('ticket replies as GitHub comments (real DB)', () => {
  let calls: Call[]
  let override: Reply | undefined

  beforeEach(async () => {
    await fixture.begin()
    calls = []
    override = undefined
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input))
      const call: Call = {
        method: init?.method ?? 'GET',
        path: url.pathname,
        ...(init?.body ? { body: JSON.parse(String(init.body)).body } : {}),
      }
      calls.push(call)
      const replaced = override?.(call)
      if (replaced) return replaced
      if (call.method === 'DELETE') return new Response(null, { status: 204 })
      const created = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/comments$/.exec(call.path)
      const edited = /^\/repos\/([^/]+\/[^/]+)\/issues\/comments\/(\d+)$/.exec(call.path)
      const id = created ? String(1000 + calls.length) : edited?.[2]
      const repo = (created ?? edited)?.[1]
      if (!id || !repo) throw new Error(`unexpected call: ${call.method} ${call.path}`)
      return Response.json({
        id: Number(id),
        html_url: `https://github.com/${repo}/issues/1#issuecomment-${id}`,
        updated_at: new Date(Date.now() + calls.length * 1000).toISOString(),
      })
    })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await fixture.rollback()
  })
  afterAll(fixture.close)

  async function teammate(name: string) {
    const [person] = await testDb
      .insert(user)
      .values({ name, email: `${unique()}@example.test` })
      .returning()
    const [p] = await testDb
      .insert(principal)
      .values({
        userId: person.id,
        type: 'user',
        role: 'admin',
        displayName: name,
        createdAt: new Date(),
      })
      .returning()
    return p
  }

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
    const opted = { postRepliesAsComments: true }
    const repos = await testDb
      .insert(integrationDestinations)
      .values(
        [
          { externalId: 'acme/api', config: opted },
          { externalId: 'acme/web', config: opted },
          { externalId: 'acme/quiet' },
          { externalId: 'acme/off', enabled: false, config: opted },
          { externalId: 'acme/reports', config: { ...opted, direction: 'inbound' as const } },
        ].map((repo) => ({ integrationId: integration.id, kind: 'repo', ...repo }))
      )
      .returning()
    const repo = Object.fromEntries(repos.map((r) => [r.externalId, r]))
    const agent = await teammate('Jane Doe')
    const requester = await teammate('Pat Customer')
    const [row] = await testDb
      .insert(tickets)
      .values({
        type: 'customer',
        title: 'Export fails on large CSVs',
        statusId: status.id,
        priority: 'high',
        requesterPrincipalId: requester.id,
      })
      .returning()
    // One issue linked in every repository, issue n in the n-th.
    const links = await testDb
      .insert(ticketExternalLinks)
      .values(
        repos.map((r, index) => ({
          ticketId: row.id,
          integrationId: integration.id,
          integrationType: 'github',
          externalId: String(index + 1),
          externalDisplayId: `${r.externalId}#${index + 1}`,
          syncScope: syncScopeFor(
            integration,
            { channelId: r.externalId },
            getIntegration('github')
          ),
          origin: 'push',
        }))
      )
      .returning()
    return { integration, servicePrincipal, repo, agent, requester, ticket: row, links }
  }
  type Seeded = Awaited<ReturnType<typeof seed>>

  const file = (name: string, contentType = 'image/png'): ConversationAttachment => ({
    url: `/api/files/${name}`,
    name,
    contentType,
    size: 10,
  })

  async function message(
    s: Seeded,
    over: Partial<typeof conversationMessages.$inferInsert> = {}
  ): Promise<typeof conversationMessages.$inferSelect> {
    const [row] = await testDb
      .insert(conversationMessages)
      .values({
        ticketId: s.ticket.id,
        principalId: s.agent.id,
        senderType: 'agent',
        content: 'Fixed in the next release.',
        ...over,
      })
      .returning()
    return row
  }

  type ReplyEvent =
    | 'ticket.replied'
    | 'ticket.reply_updated'
    | 'ticket.reply_deleted'
    | 'ticket.attachment_added'
    | 'ticket.attachment_removed'

  /** Resolve the event and queue what the ticket-comment sink routes, as the relay does. */
  async function dispatch(
    type: ReplyEvent,
    s: Seeded,
    messageId: string,
    actor: { type: 'user' | 'service'; id: string } = { type: 'user', id: s.agent.id }
  ) {
    const payload = {
      ticket: {
        id: s.ticket.id,
        number: s.ticket.number,
        type: s.ticket.type,
        ticketTypeId: null,
        priority: s.ticket.priority,
      },
      messageId,
      senderType: 'agent',
      title: s.ticket.title,
    }
    const event: DomainEvent = {
      eventId: createId('event'),
      seq: 1n,
      type,
      entityType: 'ticket',
      entityId: s.ticket.id,
      actorType: actor.type,
      actorId: actor.id,
      payload,
      context: { depth: 0 },
      schemaVersion: 1,
      occurredAt: new Date(),
    }
    const targets = await ticketCommentResolver.resolve(event)
    const queued = []
    for (const target of targets) {
      const data: HookJobData = {
        hookType: target.type,
        event: {
          id: event.eventId,
          type,
          timestamp: new Date().toISOString(),
          actor: { type: actor.type, principalId: actor.id },
          data: payload,
        } as unknown as HookJobData['event'],
        target: target.target,
        config: target.config,
      }
      queued.push(await queueHookSync(data))
    }
    return { targets, queued: queued.filter((q) => q !== null) }
  }

  async function run(operationId: string) {
    try {
      await runIntegrationSync(syncTestJob(operationId))
    } catch {
      // A retry is the job queue's to schedule; the operation records it.
    }
    return testDb.query.integrationSyncOperations.findFirst({
      where: eq(operations.id, operationId),
    })
  }

  async function runAll(queued: { id: string }[]) {
    const ops = []
    for (const op of queued) ops.push(await run(op.id))
    return ops
  }

  const repoOf = (call: Call) => /^\/repos\/([^/]+\/[^/]+)\//.exec(call.path)?.[1]
  const rows = (messageId: string) =>
    testDb
      .select()
      .from(messageExternalLinks)
      .where(eq(messageExternalLinks.messageId, messageId as never))

  it('posts a reply once to each linked issue in a repository that opted in', async () => {
    const s = await seed()
    const reply = await message(s, { attachments: [file('screen.png')] })

    const { targets, queued } = await dispatch('ticket.replied', s, reply.id)
    // Every active link is routed; queueing keeps the opted-in, sending repositories.
    expect(targets).toHaveLength(5)
    expect(queued).toHaveLength(2)
    const ops = await runAll(queued)
    expect(ops.map((op) => [op?.kind, op?.state])).toEqual([
      ['comment', 'succeeded'],
      ['comment', 'succeeded'],
    ])
    expect(calls.map((c) => `${c.method} ${c.path}`).sort()).toEqual([
      'POST /repos/acme/api/issues/1/comments',
      'POST /repos/acme/web/issues/2/comments',
    ])
    const body = calls[0].body!
    expect(body.split('\n')[0]).toBe('_Quackback reply by Jane Doe_')
    expect(body).toContain('Fixed in the next release.')
    expect(body).toMatch(/!\[screen\.png\]\([^)]*\/api\/files\/screen\.png[^)]*\)/)
    expect(body).toContain(
      `<!-- quackback:ticket-comment messageId=${reply.id} integrationId=${s.integration.id} -->`
    )
    const recorded = await rows(reply.id)
    expect(recorded).toHaveLength(2)
    expect(recorded.every((r) => r.direction === 'outbound' && r.status === 'active')).toBe(true)
    expect(recorded.map((r) => r.ticketExternalLinkId).sort()).toEqual(
      s.links
        .filter((l) => ['1', '2'].includes(l.externalId))
        .map((l) => l.id)
        .sort()
    )

    // A redelivered event lands on the same operations and posts nothing more.
    const again = await dispatch('ticket.replied', s, reply.id)
    expect(again.queued.map((q) => q!.id).sort()).toEqual(queued.map((q) => q!.id).sort())
    await runAll(again.queued)
    expect(calls).toHaveLength(2)
    expect(await rows(reply.id)).toHaveLength(2)
  })

  it("names nobody for the requester's reply and shows in Sync history under the ticket", async () => {
    const s = await seed()
    const reply = await message(s, {
      principalId: s.requester.id,
      senderType: 'visitor',
      content: 'Still broken for me.',
    })
    await runAll((await dispatch('ticket.replied', s, reply.id)).queued)
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.body!.split('\n')[0]).toBe('_Customer reply from Quackback_')
      expect(call.body).not.toContain('Pat')
      expect(call.body).not.toMatch(/@example\.test/)
    }
    const admin: Actor = {
      principalId: s.agent.id,
      role: 'admin',
      principalType: 'user',
      segmentIds: new Set(),
      permissions: resolveActorPermissions('admin'),
    }
    const history = await listSyncHistory({ provider: 'github', filter: 'all' }, admin)
    expect(history.items).toHaveLength(2)
    for (const item of history.items) {
      expect(SYNC_KIND_LABELS[item.kind]).toBe('Post reply as comment')
      expect(item.sourceTitle).toBe('Export fails on large CSVs')
      expect(item.remoteUrl).toMatch(/^https:\/\/github\.com\/acme\/(api|web)\/issues\/1#/)
    }
    const api = await listSyncHistory(
      { provider: 'github', filter: 'all', destinationId: s.repo['acme/api'].id },
      admin
    )
    expect(api.items.map((i) => i.remoteDisplayId)).toEqual(['acme/api#1'])
  })

  it('never posts an internal note or its files', async () => {
    const s = await seed()
    const note = await message(s, {
      isInternal: true,
      content: 'PRIVATE: refund them.',
      attachments: [file('secret.pdf', 'application/pdf')],
    })
    const reply = await message(s, { attachments: [file('public.png')] })

    // The ledger turns a note away structurally, whichever event names it.
    for (const type of ['ticket.replied', 'ticket.attachment_added'] as const) {
      const { queued } = await dispatch(type, s, note.id)
      for (const op of queued) expect(op?.state).toBe('cancelled')
    }
    await runAll((await dispatch('ticket.replied', s, reply.id)).queued)
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.body).toContain('public.png')
      expect(call.body).not.toContain('PRIVATE')
      expect(call.body).not.toContain('secret.pdf')
    }
    expect(await rows(note.id)).toHaveLength(0)
  })

  it('rewrites the comment when the reply is edited or its files change', async () => {
    const s = await seed()
    const reply = await message(s)
    await runAll((await dispatch('ticket.replied', s, reply.id)).queued)
    calls = []

    await testDb
      .update(conversationMessages)
      .set({ content: 'Fixed in 2.4.1, out today.', editedAt: new Date() })
      .where(eq(conversationMessages.id, reply.id))
    const edit = await dispatch('ticket.reply_updated', s, reply.id)
    expect((await runAll(edit.queued)).map((op) => [op?.kind, op?.state])).toEqual([
      ['comment-update', 'succeeded'],
      ['comment-update', 'succeeded'],
    ])
    const recorded = await rows(reply.id)
    expect(calls.map((c) => c.method)).toEqual(['PATCH', 'PATCH'])
    // The comments posted for the reply, by the ids recorded for them.
    expect(calls.map((c) => c.path.split('/').pop()).sort()).toEqual(
      recorded.map((r) => r.externalId).sort()
    )
    expect(calls[0].body).toContain('Fixed in 2.4.1, out today.')
    expect(calls[0].body).toContain(`messageId=${reply.id}`)
    expect(recorded.every((r) => r.remoteVersion)).toBe(true)

    calls = []
    await testDb
      .update(conversationMessages)
      .set({ attachments: [file('fix.png')] })
      .where(eq(conversationMessages.id, reply.id))
    await runAll((await dispatch('ticket.attachment_added', s, reply.id)).queued)
    expect(calls.map((c) => c.method)).toEqual(['PATCH', 'PATCH'])
    expect(calls[0].body).toMatch(/!\[fix\.png\]/)

    calls = []
    await testDb
      .update(conversationMessages)
      .set({ attachments: [] })
      .where(eq(conversationMessages.id, reply.id))
    await runAll((await dispatch('ticket.attachment_removed', s, reply.id)).queued)
    expect(calls.map((c) => c.method)).toEqual(['PATCH', 'PATCH'])
    expect(calls[0].body).not.toContain('fix.png')
    expect(calls[0].body).not.toContain('### Attachments')
  })

  it('deletes the comment with its reply, and a comment already gone counts as deleted', async () => {
    const s = await seed()
    const reply = await message(s)
    await runAll((await dispatch('ticket.replied', s, reply.id)).queued)
    calls = []
    // acme/web's comment was removed on GitHub already.
    override = (call) =>
      call.method === 'DELETE' && repoOf(call) === 'acme/web'
        ? new Response('Not Found', { status: 404 })
        : undefined

    await testDb
      .update(conversationMessages)
      .set({ deletedAt: new Date() })
      .where(eq(conversationMessages.id, reply.id))
    const removal = await dispatch('ticket.reply_deleted', s, reply.id)
    const ops = await runAll(removal.queued)
    expect(ops.map((op) => [op?.kind, op?.sourceType, op?.state])).toEqual([
      ['comment-delete', 'ticket', 'succeeded'],
      ['comment-delete', 'ticket', 'succeeded'],
    ])
    expect(calls.map((c) => c.method)).toEqual(['DELETE', 'DELETE'])
    expect((await rows(reply.id)).map((r) => r.status)).toEqual(['deleted', 'deleted'])

    // Deleted is final: a redelivery or a late edit writes nothing.
    calls = []
    await runAll((await dispatch('ticket.reply_deleted', s, reply.id)).queued)
    expect((await dispatch('ticket.reply_updated', s, reply.id)).queued).toEqual([])
    expect(calls).toEqual([])
  })

  it('waits for a comment still being posted before rewriting or deleting it', async () => {
    const s = await seed()
    const reply = await message(s)
    const posting = await dispatch('ticket.replied', s, reply.id)
    const edit = await dispatch('ticket.reply_updated', s, reply.id)
    expect(edit.queued).toHaveLength(2)
    expect((await runAll(edit.queued)).map((op) => op?.state)).toEqual(['retry_wait', 'retry_wait'])
    expect(calls).toEqual([])
    await runAll(posting.queued)
    await runAll(edit.queued)
    expect(calls.map((c) => c.method)).toEqual(['POST', 'POST', 'PATCH', 'PATCH'])

    // A reply that was never posted (its repository opted out first) has nothing to follow.
    const quiet = await message(s)
    await testDb
      .update(integrationDestinations)
      .set({ config: {} })
      .where(eq(integrationDestinations.id, s.repo['acme/web'].id))
    const late = await dispatch('ticket.replied', s, quiet.id)
    expect(late.queued).toHaveLength(1)
    expect((await dispatch('ticket.reply_updated', s, quiet.id)).queued).toHaveLength(1)
  })

  it('asks again before posting: a repository opted out or switched off meanwhile gets nothing', async () => {
    const s = await seed()
    const reply = await message(s)
    const { queued } = await dispatch('ticket.replied', s, reply.id)
    await testDb
      .update(integrationDestinations)
      .set({ config: {} })
      .where(eq(integrationDestinations.id, s.repo['acme/api'].id))
    await testDb
      .update(integrationDestinations)
      .set({ enabled: false })
      .where(eq(integrationDestinations.id, s.repo['acme/web'].id))
    expect((await runAll(queued)).map((op) => [op?.state, op?.errorCode])).toEqual([
      ['cancelled', 'source_unavailable'],
      ['cancelled', 'source_unavailable'],
    ])
    expect(calls).toEqual([])
  })

  it('sends back nothing the integration wrote', async () => {
    const s = await seed()
    const fromGitHub = await message(s, {
      principalId: s.servicePrincipal as PrincipalId,
      content: 'A comment from GitHub.',
    })
    const service = { type: 'service' as const, id: s.servicePrincipal }
    expect((await dispatch('ticket.replied', s, fromGitHub.id, service)).targets).toEqual([])

    // Even routed past the resolver, queueing applies the rule.
    const data = {
      hookType: 'ticket_comment',
      event: {
        id: randomUUID(),
        type: 'ticket.replied',
        timestamp: new Date().toISOString(),
        actor: { type: 'service', principalId: s.servicePrincipal },
        data: { ticket: { id: s.ticket.id }, messageId: fromGitHub.id },
      },
      target: { linkId: s.links[0].id },
      config: { integrationId: s.integration.id },
    } as unknown as HookJobData
    expect(await queueHookSync(data)).toBeNull()

    // And the worker will not post a reply its principal wrote, whoever announced it.
    const { queued } = await dispatch('ticket.replied', s, fromGitHub.id)
    expect((await runAll(queued)).map((op) => op?.state)).toEqual(['cancelled', 'cancelled'])
    expect(calls).toEqual([])
  })

  it('leaves a ticket paired with a GitHub inbox conversation to the channel', async () => {
    const s = await seed()
    const [conversation] = await testDb
      .insert(conversations)
      .values({ visitorPrincipalId: s.requester.id, channel: 'github' })
      .returning()
    await testDb
      .insert(ticketConversations)
      .values({ ticketId: s.ticket.id, conversationId: conversation.id, ticketType: 'customer' })
    const reply = await message(s, { ticketId: null, conversationId: conversation.id })
    expect((await dispatch('ticket.replied', s, reply.id)).queued).toEqual([])
    expect(await testDb.select().from(operations)).toHaveLength(0)
  })

  it('posts a reply on the linked conversation of an email ticket', async () => {
    const s = await seed()
    const [conversation] = await testDb
      .insert(conversations)
      .values({ visitorPrincipalId: s.requester.id, channel: 'email' })
      .returning()
    await testDb
      .insert(ticketConversations)
      .values({ ticketId: s.ticket.id, conversationId: conversation.id, ticketType: 'customer' })
    const reply = await message(s, {
      ticketId: null,
      conversationId: conversation.id,
      content: 'Sent from the email thread.',
    })
    await runAll((await dispatch('ticket.replied', s, reply.id)).queued)
    expect(calls).toHaveLength(2)
    expect(calls[0].body).toContain('Sent from the email thread.')
  })

  it.each([
    [401, 'auth_required', 'authentication'],
    [404, 'failed', 'provider_failed'],
    [422, 'failed', 'provider_failed'],
    [429, 'retry_wait', 'unavailable'],
    [500, 'uncertain', 'outcome_unknown'],
  ] as const)('records a %i from GitHub on the comment as %s', async (status, state, errorCode) => {
    const s = await seed()
    const reply = await message(s)
    override = () => new Response('nope', { status })
    const { queued } = await dispatch('ticket.replied', s, reply.id)
    const [op] = await runAll(queued.slice(0, 1))
    expect([op?.state, op?.errorCode]).toEqual([state, errorCode])
    expect(await rows(reply.id)).toHaveLength(0)
  })

  it('a rewrite that finds the comment deleted on GitHub records it gone and keeps the reply', async () => {
    const s = await seed()
    const reply = await message(s)
    await runAll((await dispatch('ticket.replied', s, reply.id)).queued)
    override = (call) =>
      call.method === 'PATCH' ? new Response('Not Found', { status: 404 }) : undefined
    const edit = await dispatch('ticket.reply_updated', s, reply.id)
    expect((await runAll(edit.queued)).map((op) => op?.state)).toEqual(['succeeded', 'succeeded'])
    expect((await rows(reply.id)).map((r) => r.status)).toEqual(['deleted', 'deleted'])
    expect(
      (
        await testDb.query.conversationMessages.findFirst({
          where: eq(conversationMessages.id, reply.id),
        })
      )?.deletedAt
    ).toBeNull()
    // Nothing is left to follow: a later edit queues nothing.
    calls = []
    expect((await dispatch('ticket.reply_updated', s, reply.id)).queued).toEqual([])
    expect(calls).toEqual([])
  })

  it('switching replies on records when, once, and a settings patch cannot set it', async () => {
    const s = await seed()
    const { updateDestinationConfig } = await import('@/lib/server/integrations/destination-admin')
    const quiet = s.repo['acme/quiet']
    const before = Date.now()
    await updateDestinationConfig(quiet.id, { postRepliesAsComments: true })
    const reread = async () =>
      (await testDb.query.integrationDestinations.findFirst({
        where: eq(integrationDestinations.id, quiet.id),
      }))!.config
    const since = (await reread()).postRepliesAsCommentsSince as string
    expect(Date.parse(since)).toBeGreaterThanOrEqual(before)
    await updateDestinationConfig(quiet.id, { postRepliesAsComments: true })
    expect((await reread()).postRepliesAsCommentsSince).toBe(since)
    await expect(
      updateDestinationConfig(quiet.id, { postRepliesAsCommentsSince: '2020-01-01T00:00:00Z' })
    ).rejects.toThrow('These settings are not valid here')
  })

  it('retries a rewrite or delete whose outcome GitHub left unknown', async () => {
    const s = await seed()
    const reply = await message(s)
    await runAll((await dispatch('ticket.replied', s, reply.id)).queued)
    override = () => new Response('busy', { status: 502 })
    const { queued } = await dispatch('ticket.reply_updated', s, reply.id)
    const [op] = await runAll(queued.slice(0, 1))
    expect([op?.state, op?.errorCode]).toEqual(['retry_wait', 'unavailable'])
  })
})
