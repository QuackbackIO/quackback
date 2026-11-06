/**
 * Linked GitHub issues following their tickets automatically, against a real
 * database, in a repository that switched "Update GitHub issues
 * automatically" on. The issue-update resolver routes a ticket's status,
 * priority, assignee and title changes to each active link, the ledger
 * queues one operation per change and linked issue there, and the worker
 * writes it through GitHub's guarded write and records the issue's new state
 * and version on the link.
 *
 * Nothing is written in a repository that did not opt in (a status change
 * stays a review proposal), is switched off or only receives; nothing for a
 * change the integration made or integration sync applied; nothing for a
 * ticket paired with a GitHub inbox conversation. An issue changed on GitHub
 * since we last saw it gets a review, not a write; settling it resumes
 * updates. An older change never overwrites a newer one.
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
  integrations,
  integrationDestinations,
  integrationSyncOperations as operations,
  integrationUserMappings,
  principal,
  settings,
  ticketConversations,
  ticketExternalLinks,
  ticketStatuses,
  tickets,
  user,
} from '@/lib/server/db'
import { encryptSecrets } from '@/lib/server/integrations/encryption'
import { getIntegration } from '@/lib/server/integrations'
import { syncScopeFor } from '@/lib/server/integrations/sync/identity'
import { issueUpdateResolver } from '@/lib/server/events/resolvers/issue-update.resolver'
import { remoteStatusPushResolver } from '@/lib/server/events/resolvers/remote-status-push.resolver'
import { queueHookSync } from '@/lib/server/integrations/sync/hooks'
import { runIntegrationSync } from '@/lib/server/integrations/sync/worker'
import { actOnSync, listSyncHistory } from '@/lib/server/integrations/sync/history'
import { syncTestJob } from '@/lib/server/integrations/sync/__tests__/job'
import { ticketIssueMarker } from '@/integrations/github/server/ticket-issue'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { HookJobData } from '@/lib/server/events/hook-job'
import type { DomainEvent } from '@/lib/server/events/envelope'
import type { HookTarget } from '@/lib/server/events/hook-types'
import type { Actor } from '@/lib/server/policy/types'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: integrationUserMappings.id }).from(integrationUserMappings).limit(0)
  },
})

const unique = () => randomUUID().slice(0, 8)

type Call = { method: string; path: string; body?: Record<string, unknown> }

interface FakeIssue {
  number: number
  state: 'open' | 'closed'
  state_reason: string | null
  title: string
  body: string
  updated_at: string
  labels: { name: string }[]
  assignees: { login: string }[]
}

describe.skipIf(!fixture.available)('GitHub issues updated automatically (real DB)', () => {
  let calls: Call[]
  /** GitHub's issues, by `owner/repo#number`. */
  let issues: Map<string, FakeIssue>
  let timeline: Array<Record<string, unknown>>
  let clock: number

  const tick = () => new Date((clock += 60_000)).toISOString()

  beforeEach(async () => {
    await fixture.begin()
    calls = []
    issues = new Map()
    timeline = []
    clock = Date.now()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input))
      const call: Call = {
        method: init?.method ?? 'GET',
        path: url.pathname,
        ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      }
      calls.push(call)
      const match = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)(\/.*)?$/.exec(call.path)
      if (!match) throw new Error(`unexpected call: ${call.method} ${call.path}`)
      const issue = issues.get(`${match[1]}#${match[2]}`)
      if (!issue) return new Response('Not Found', { status: 404 })
      const rest = match[3] ?? ''
      if (rest === '/timeline') return Response.json(timeline)
      if (call.method === 'GET') return Response.json(issue)
      if (call.method === 'PATCH') {
        Object.assign(issue, call.body, {
          ...(call.body?.assignees
            ? { assignees: (call.body.assignees as string[]).map((login) => ({ login })) }
            : {}),
          updated_at: tick(),
        })
        return Response.json(issue)
      }
      if (call.method === 'POST' && rest === '/labels') {
        for (const name of call.body!.labels as string[]) issue.labels.push({ name })
        issue.updated_at = tick()
        return Response.json(issue.labels)
      }
      if (call.method === 'DELETE' && rest.startsWith('/labels/')) {
        const name = decodeURIComponent(rest.slice('/labels/'.length))
        issue.labels = issue.labels.filter((l) => l.name !== name)
        issue.updated_at = tick()
        return Response.json(issue.labels)
      }
      throw new Error(`unexpected call: ${call.method} ${call.path}`)
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

  async function status(
    name: string,
    category: 'open' | 'pending' | 'closed',
    publicStage: 'received' | 'in_progress' | 'awaiting_requester' | 'resolved' | null
  ) {
    const [row] = await testDb
      .insert(ticketStatuses)
      .values({ name, slug: `s_${unique()}`, category, position: 100, publicStage })
      .returning()
    return row
  }

  async function seed() {
    await testDb
      .insert(settings)
      .values({ name: 'Acme', slug: `acme-${unique()}`, createdAt: new Date() })
    const statuses = {
      investigating: await status('Investigating', 'open', 'in_progress'),
      waiting: await status('Waiting on customer', 'pending', 'awaiting_requester'),
      thirdParty: await status('Waiting on third party', 'pending', 'in_progress'),
      resolved: await status('Resolved', 'closed', 'resolved'),
      wontDo: await status("Won't do", 'closed', null),
    }
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
    const auto = { applyAutomatically: true, assigneeSync: true }
    const repos = await testDb
      .insert(integrationDestinations)
      .values(
        [
          { externalId: 'acme/api', config: auto },
          { externalId: 'acme/quiet' },
          { externalId: 'acme/off', enabled: false, config: auto },
          { externalId: 'acme/reports', config: { ...auto, direction: 'inbound' as const } },
        ].map((repo) => ({ integrationId: integration.id, kind: 'repo', ...repo }))
      )
      .returning()
    const repo = Object.fromEntries(repos.map((r) => [r.externalId, r]))
    const agent = await teammate('Jane Doe')
    const requester = await teammate('Pat Customer')
    const [ticket] = await testDb
      .insert(tickets)
      .values({
        type: 'customer',
        title: 'Export fails on large CSVs',
        statusId: statuses.investigating.id,
        priority: 'low',
        requesterPrincipalId: requester.id,
      })
      .returning()
    // One issue linked in every repository, issue n in the n-th, each open on GitHub.
    const links = await testDb
      .insert(ticketExternalLinks)
      .values(
        repos.map((r, index) => ({
          ticketId: ticket.id,
          integrationId: integration.id,
          integrationType: 'github',
          externalId: String(index + 1),
          externalDisplayId: `${r.externalId}#${index + 1}`,
          externalUrl: `https://github.com/${r.externalId}/issues/${index + 1}`,
          syncScope: syncScopeFor(
            integration,
            { channelId: r.externalId },
            getIntegration('github')
          ),
          origin: 'push',
          createdAt: new Date(clock),
        }))
      )
      .returning()
    for (const [index, r] of repos.entries())
      issues.set(`${r.externalId}#${index + 1}`, {
        number: index + 1,
        state: 'open',
        state_reason: null,
        title: ticket.title,
        body: `Steps\n\n${ticketIssueMarker(ticket.id, integration.id)}`,
        updated_at: new Date(clock - 60_000).toISOString(),
        labels: [{ name: 'bug' }, { name: 'priority:low' }],
        assignees: [],
      })
    return { integration, servicePrincipal, statuses, repo, agent, requester, ticket, links }
  }
  type Seeded = Awaited<ReturnType<typeof seed>>

  const apiIssue = () => issues.get('acme/api#1')!
  const apiLink = (s: Seeded) => s.links.find((l) => l.externalId === '1')!

  type TicketEvent =
    'ticket.status_changed' | 'ticket.priority_changed' | 'ticket.assigned' | 'ticket.updated'

  /** Resolve the event and queue what a sink routes, as the relay does. */
  async function dispatch(
    type: TicketEvent,
    s: Seeded,
    data: Record<string, unknown> = {},
    options: {
      actor?: { type: 'user' | 'service'; id: string }
      source?: string
      at?: Date
      resolver?: { resolve: (event: DomainEvent) => Promise<HookTarget[]> }
    } = {}
  ) {
    const actor = options.actor ?? { type: 'user' as const, id: s.agent.id }
    const at = options.at ?? new Date()
    const payload = {
      ticket: {
        id: s.ticket.id,
        number: s.ticket.number,
        type: s.ticket.type,
        ticketTypeId: null,
        priority: s.ticket.priority,
      },
      title: s.ticket.title,
      ...data,
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
      context: { depth: 0, ...(options.source ? { source: options.source } : {}) },
      schemaVersion: 1,
      occurredAt: at,
    }
    const targets = await (options.resolver ?? issueUpdateResolver).resolve(event)
    const queued = []
    for (const target of targets) {
      const job: HookJobData = {
        hookType: target.type,
        event: {
          id: event.eventId,
          type,
          timestamp: at.toISOString(),
          actor: { type: actor.type, principalId: actor.id },
          data: payload,
        } as unknown as HookJobData['event'],
        target: target.target,
        config: target.config,
      }
      queued.push(await queueHookSync(job))
    }
    return { targets, queued: queued.filter((q) => q !== null) }
  }

  async function setTicket(s: Seeded, values: Partial<typeof tickets.$inferInsert>) {
    await testDb.update(tickets).set(values).where(eq(tickets.id, s.ticket.id))
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

  const writes = () => calls.filter((c) => c.method !== 'GET')
  const labels = () =>
    apiIssue()
      .labels.map((l) => l.name)
      .sort()

  it('closes the issue as completed when the ticket is resolved, and records what it saw', async () => {
    const s = await seed()
    await setTicket(s, { statusId: s.statuses.resolved.id })
    const { targets, queued } = await dispatch('ticket.status_changed', s)
    // Every active link is routed; queueing keeps the opted-in, sending repository.
    expect(targets).toHaveLength(4)
    expect(queued).toHaveLength(1)
    const [op] = await runAll(queued)
    expect([op?.kind, op?.state]).toEqual(['issue-status', 'succeeded'])
    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual(['PATCH /repos/acme/api/issues/1'])
    expect(writes()[0].body).toEqual({ state: 'closed', state_reason: 'completed' })
    const link = await testDb.query.ticketExternalLinks.findFirst({
      where: eq(ticketExternalLinks.id, apiLink(s).id),
    })
    expect(link?.remoteState).toBe('Closed')
    expect(link?.remoteStateAt?.toISOString()).toBe(apiIssue().updated_at)

    // Our own write is the new baseline: the next change goes straight through.
    calls = []
    await setTicket(s, { statusId: s.statuses.wontDo.id })
    const [next] = await runAll((await dispatch('ticket.status_changed', s)).queued)
    expect(next?.state).toBe('succeeded')
    expect(writes()[0].body).toEqual({ state: 'closed', state_reason: 'not_planned' })
  })

  it('swaps the status label, leaving labels Quackback does not own', async () => {
    const s = await seed()
    await setTicket(s, { statusId: s.statuses.thirdParty.id })
    await runAll((await dispatch('ticket.status_changed', s)).queued)
    expect(labels()).toEqual(['bug', 'on-hold', 'priority:low'])

    await setTicket(s, { statusId: s.statuses.waiting.id })
    await runAll((await dispatch('ticket.status_changed', s)).queued)
    expect(labels()).toEqual(['bug', 'priority:low', 'waiting-on-customer'])

    await setTicket(s, { statusId: s.statuses.investigating.id })
    await runAll((await dispatch('ticket.status_changed', s)).queued)
    expect(labels()).toEqual(['bug', 'priority:low'])
    expect(apiIssue().state).toBe('open')
  })

  it("uses the repository's own status mapping, and leaves the issue alone for a null one", async () => {
    const s = await seed()
    await testDb
      .update(integrationDestinations)
      .set({
        config: {
          applyAutomatically: true,
          pushStatusMappings: {
            [s.statuses.resolved.id]: {
              state: 'closed',
              stateReason: 'completed',
              label: 'shipped',
            },
            [s.statuses.wontDo.id]: null,
          },
        },
      })
      .where(eq(integrationDestinations.id, s.repo['acme/api'].id))
    await setTicket(s, { statusId: s.statuses.wontDo.id })
    expect((await dispatch('ticket.status_changed', s)).queued).toEqual([])

    await setTicket(s, { statusId: s.statuses.resolved.id })
    await runAll((await dispatch('ticket.status_changed', s)).queued)
    expect(apiIssue()).toMatchObject({ state: 'closed', state_reason: 'completed' })
    expect(labels()).toEqual(['bug', 'priority:low', 'shipped'])
  })

  it('swaps the priority label, and removes it for none', async () => {
    const s = await seed()
    await setTicket(s, { priority: 'urgent' })
    await runAll(
      (
        await dispatch('ticket.priority_changed', s, {
          previousPriority: 'low',
          newPriority: 'urgent',
        })
      ).queued
    )
    expect(labels()).toEqual(['bug', 'priority:urgent'])

    await setTicket(s, { priority: 'none' })
    const [op] = await runAll(
      (
        await dispatch('ticket.priority_changed', s, {
          previousPriority: 'urgent',
          newPriority: 'none',
        })
      ).queued
    )
    expect(op?.kind).toBe('issue-priority')
    expect(labels()).toEqual(['bug'])
  })

  it('follows the assignee through account matches: matched, unmatched and unassigned', async () => {
    const s = await seed()
    const other = await teammate('Unmatched Person')
    await testDb.insert(integrationUserMappings).values({
      integrationId: s.integration.id,
      externalUserId: '583231',
      externalLogin: 'octocat',
      principalId: s.agent.id,
    })
    await setTicket(s, { assigneePrincipalId: s.agent.id })
    await runAll((await dispatch('ticket.assigned', s, { assignedPrincipalId: s.agent.id })).queued)
    expect(apiIssue().assignees).toEqual([{ login: 'octocat' }])

    await setTicket(s, { assigneePrincipalId: other.id })
    await runAll((await dispatch('ticket.assigned', s, { assignedPrincipalId: other.id })).queued)
    expect(apiIssue().assignees).toEqual([])

    await setTicket(s, { assigneePrincipalId: s.agent.id })
    await runAll((await dispatch('ticket.assigned', s, { assignedPrincipalId: s.agent.id })).queued)
    await setTicket(s, { assigneePrincipalId: null })
    const [op] = await runAll(
      (await dispatch('ticket.assigned', s, { assignedPrincipalId: null })).queued
    )
    expect(op?.kind).toBe('issue-assignees')
    expect(apiIssue().assignees).toEqual([])
  })

  it('leaves assignees alone in a repository without assignee sync', async () => {
    const s = await seed()
    await testDb
      .update(integrationDestinations)
      .set({ config: { applyAutomatically: true } })
      .where(eq(integrationDestinations.id, s.repo['acme/api'].id))
    await setTicket(s, { assigneePrincipalId: s.agent.id })
    expect(
      (await dispatch('ticket.assigned', s, { assignedPrincipalId: s.agent.id })).queued
    ).toEqual([])
  })

  it('renames the issue and re-renders a body that still carries our marker, never one a person wrote', async () => {
    const s = await seed()
    await setTicket(s, { title: 'Export fails on every CSV' })
    const renamed = { title: 'Export fails on every CSV', previousTitle: s.ticket.title }
    const [op] = await runAll(
      (await dispatch('ticket.updated', s, { ...renamed, changedKeys: ['title'] })).queued
    )
    expect(op?.kind).toBe('issue-title')
    expect(writes()[0].body?.title).toBe('Export fails on every CSV')
    expect(String(writes()[0].body?.body)).toContain(
      ticketIssueMarker(s.ticket.id, s.integration.id)
    )

    calls = []
    apiIssue().body = 'Rewritten by a maintainer, marker gone'
    await setTicket(s, { title: 'CSV export broken' })
    await runAll(
      (
        await dispatch('ticket.updated', s, {
          title: 'CSV export broken',
          previousTitle: renamed.title,
          changedKeys: ['title'],
        })
      ).queued
    )
    expect(writes()[0].body).toEqual({ title: 'CSV export broken' })
    expect(apiIssue().body).toBe('Rewritten by a maintainer, marker gone')

    // An update that left the title alone asks nothing of the issue.
    expect((await dispatch('ticket.updated', s, { changedKeys: [] })).targets).toEqual([])
  })

  it('makes a review, writing nothing, when the issue changed on GitHub; settling it resumes updates', async () => {
    const s = await seed()
    // Someone relabelled the issue after the link was made (and before now).
    apiIssue().updated_at = new Date(clock + 1).toISOString()
    timeline = [{ event: 'labeled', created_at: apiIssue().updated_at }]
    await setTicket(s, { statusId: s.statuses.resolved.id })
    const [op] = await runAll((await dispatch('ticket.status_changed', s)).queued)
    expect([op?.state, op?.errorCode]).toEqual(['conflict', 'manual_update'])
    expect(writes()).toEqual([])
    expect(apiIssue().state).toBe('open')

    const admin = manager(s.agent.id)
    const history = await listSyncHistory({ provider: 'github', filter: 'attention' }, admin)
    const item = history.items.find((i) => i.id === op!.id)
    expect(item).toMatchObject({ kind: 'issue-status', state: 'conflict' })
    expect(item?.actions).toContain('keep_remote')

    await actOnSync(
      { id: op!.id, version: op!.version, actionId: randomUUID(), action: 'keep_remote' },
      admin
    )
    calls = []
    await setTicket(s, { statusId: s.statuses.wontDo.id })
    const [next] = await runAll((await dispatch('ticket.status_changed', s)).queued)
    expect(next?.state).toBe('succeeded')
    expect(writes()[0].body).toEqual({ state: 'closed', state_reason: 'not_planned' })
  })

  it('makes a review when the issue was closed on GitHub since we last saw it', async () => {
    const s = await seed()
    await testDb
      .update(ticketExternalLinks)
      .set({ remoteState: 'Open', remoteStateAt: new Date(clock) })
      .where(eq(ticketExternalLinks.id, apiLink(s).id))
    Object.assign(apiIssue(), { state: 'closed', state_reason: 'completed' })
    await setTicket(s, { title: 'Renamed in Quackback' })
    const [op] = await runAll(
      (
        await dispatch('ticket.updated', s, {
          title: 'Renamed in Quackback',
          changedKeys: ['title'],
        })
      ).queued
    )
    expect(op?.state).toBe('conflict')
    expect(writes()).toEqual([])
  })

  it('supersedes an older change once a newer one for the same issue exists', async () => {
    const s = await seed()
    const earlier = new Date()
    const later = new Date(earlier.getTime() + 1000)
    await setTicket(s, { statusId: s.statuses.resolved.id })
    const first = await dispatch('ticket.status_changed', s, {}, { at: earlier })
    await setTicket(s, { statusId: s.statuses.investigating.id })
    const second = await dispatch('ticket.status_changed', s, {}, { at: later })
    // The newer runs first; the older one, arriving late, must not close the issue.
    const [newer] = await runAll(second.queued)
    const [older] = await runAll(first.queued)
    expect(newer?.state).toBe('succeeded')
    expect(older?.state).toBe('superseded')
    expect(apiIssue().state).toBe('open')
    expect(writes()).toEqual([])
  })

  it('keeps the review proposal when the repository did not opt in', async () => {
    const s = await seed()
    await testDb
      .update(integrations)
      .set({
        config: {
          channelId: 'acme/api',
          username: 'acme-bot',
          ticketPushStatusMappings: { [s.statuses.resolved.id]: 'Closed' },
        },
      })
      .where(eq(integrations.id, s.integration.id))
    await setTicket(s, { statusId: s.statuses.resolved.id })
    const { queued } = await dispatch(
      'ticket.status_changed',
      s,
      {},
      { resolver: remoteStatusPushResolver }
    )
    // Proposals for every link but the one in the repository that updates automatically.
    const ops = await Promise.all(
      queued.map((q) =>
        testDb.query.integrationSyncOperations.findFirst({ where: eq(operations.id, q!.id) })
      )
    )
    expect(ops.map((op) => [op?.kind, op?.state, op?.remoteId]).sort()).toEqual([
      ['status', 'conflict', '2'],
      ['status', 'conflict', '3'],
      ['status', 'conflict', '4'],
    ])
    expect(calls).toEqual([])
  })

  it('writes nothing when the opted-in repository is switched off or receives only', async () => {
    const s = await seed()
    await testDb
      .update(integrationDestinations)
      .set({ enabled: false })
      .where(eq(integrationDestinations.id, s.repo['acme/api'].id))
    await setTicket(s, { statusId: s.statuses.resolved.id })
    expect((await dispatch('ticket.status_changed', s)).queued).toEqual([])
    expect(calls).toEqual([])
  })

  it('never sends back what the integration did, nor what integration sync applied', async () => {
    const s = await seed()
    await setTicket(s, { statusId: s.statuses.resolved.id })
    const own = await dispatch(
      'ticket.status_changed',
      s,
      {},
      { actor: { type: 'service', id: s.servicePrincipal } }
    )
    expect(own.targets).toEqual([])
    const synced = await dispatch(
      'ticket.status_changed',
      s,
      {},
      { actor: { type: 'service', id: createId('principal') }, source: 'integration-sync' }
    )
    expect(synced.targets).toEqual([])
    expect(await testDb.select().from(operations)).toHaveLength(0)
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
    await setTicket(s, { statusId: s.statuses.resolved.id })
    expect((await dispatch('ticket.status_changed', s)).queued).toEqual([])
    expect(await testDb.select().from(operations)).toHaveLength(0)
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
})
