/**
 * The GitHub sync series end to end: one connection, two repositories, a real
 * database and every Quackback service on the real path, against an in-memory
 * GitHub that answers the REST API and records each call. Nothing reaches the
 * network; a signed delivery is built the way GitHub signs it and handed to
 * the inbound handler, and the work a commit would wake (event dispatch, the
 * sync ledger) is run here in order, as the job worker would run it.
 *
 * The steps share one rolled-back transaction and follow one story:
 * connecting registers a hook per repository with its own secret; acme/app
 * brings its issues in as tickets, refusing a delivery for an unknown
 * repository or a bad signature; acme/api opens one issue for a matching
 * ticket, takes its public replies as comments (rewritten and deleted with
 * them, never a note) and brings its comments back as notes, ignoring our own
 * echo; a close of acme/app#1 moves only acme/app's ticket although acme/api
 * has an issue #1 too; and disconnecting removes both hooks before the token
 * is revoked.
 */
import { afterAll, beforeAll, afterEach, describe, it, expect, vi } from 'vitest'
import { createHmac, randomUUID } from 'node:crypto'

// The deployment this workspace runs as: hooks call back to its origin.
vi.hoisted(() => {
  process.env.BASE_URL = 'https://help.acme.test'
  process.env.SECRET_KEY ||= 'x'.repeat(32)
})

import { createId, type PrincipalId, type TicketId, type TicketStatusId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/secret-key', () => ({
  activeSecretKey: () => 'integration-sync-review-key-32-characters-only',
}))
// Redis and the realtime bus are infrastructure, not part of the chain.
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
// The disconnect is a server function: run its handler in process, as a
// signed-in admin (the session lookup is the only thing stood in for).
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const builder = { validator: () => builder, handler: (handler: unknown) => handler }
    return builder
  },
}))
vi.mock('@tanstack/react-start/server', () => ({ getRequestHeaders: () => new Headers() }))
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: vi.fn(async () => ({
    user: { id: 'user_01h455vb4pex5vsknk084sn02q', email: 'admin@example.test' },
    principal: { role: 'admin', type: 'user' },
  })),
}))

import {
  and,
  eq,
  sql,
  conversations,
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
  ticketTypes,
  tickets,
  user,
} from '@/lib/server/db'
import { encryptSecrets } from '@/lib/server/integrations/encryption'
import { readDestinationSecret } from '@/lib/server/integrations/destinations'
import {
  addDestination,
  setDestinationTicketIssues,
  updateDestinationConfig,
} from '@/lib/server/integrations/destination-admin'
import { handleInboundWebhook } from '@/lib/server/integrations/inbound-webhook-handler'
import { runIntegrationSync } from '@/lib/server/integrations/sync/worker'
import { syncTestJob } from '@/lib/server/integrations/sync/__tests__/job'
import { runEventDispatch } from '@/lib/server/events/event-dispatch-queue'
import { ensureGitHubConnectionAccount } from '@/lib/server/domains/channel-accounts/github-connection'
import { createTicket } from '@/lib/server/domains/tickets/ticket.service'
import {
  addTicketNote,
  sendTicketMessage,
} from '@/lib/server/domains/tickets/ticket-message.service'
import { editConversationMessage } from '@/lib/server/domains/conversation/conversation.edit'
import { deleteConversationMessage } from '@/lib/server/domains/conversation/conversation.service'
import { savePlatformCredentials } from '@/lib/server/domains/platform-credentials/platform-credential.service'
import { deleteIntegrationFn } from '@/lib/server/functions/integrations'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import type { Actor } from '@/lib/server/policy/types'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: messageExternalLinks.id }).from(messageExternalLinks).limit(0)
  },
})

const unique = () => randomUUID().slice(0, 8)
const ADMIN_USER_ID = 'user_01h455vb4pex5vsknk084sn02q'

// ============================================================================
// An in-memory GitHub
// ============================================================================

interface GitHubUser {
  id: number
  login: string
}
interface FakeIssue {
  number: number
  title: string
  body: string
  state: 'open' | 'closed'
  state_reason: string | null
  labels: string[]
  assignees: string[]
  user: GitHubUser
  html_url: string
  created_at: string
  updated_at: string
}
interface FakeComment {
  id: number
  issueNumber: number
  body: string
  user: GitHubUser
  html_url: string
  created_at: string
  updated_at: string
}
interface FakeHook {
  id: number
  events: string[]
  secret: string
  url: string
}
interface FakeRepo {
  id: number
  full_name: string
  hooks: Map<number, FakeHook>
  issues: Map<number, FakeIssue>
  comments: Map<number, FakeComment>
}
interface GitHubCall {
  method: string
  path: string
  body?: Record<string, unknown>
}

/**
 * Just enough of GitHub's REST API for the sync: repositories, their hooks,
 * issues numbered per repository, comments (ids global, as GitHub's are),
 * labels and assignees, each write moving `updated_at` forward. Every call is
 * recorded; one it does not know is recorded as unhandled and answered 404.
 */
function fakeGitHub(bot: GitHubUser) {
  const repos = new Map<string, FakeRepo>()
  const calls: GitHubCall[] = []
  const unhandled: string[] = []
  let nextHookId = 900
  let nextCommentId = 5000
  let clock = Date.now()
  const tick = () => new Date((clock += 1000)).toISOString()

  function repo(fullName: string, id: number): FakeRepo {
    const created = {
      id,
      full_name: fullName,
      hooks: new Map(),
      issues: new Map(),
      comments: new Map(),
    }
    repos.set(fullName, created)
    return created
  }
  function openIssue(fullName: string, author: GitHubUser, title: string, body: string) {
    const r = repos.get(fullName)!
    const number = r.issues.size + 1
    const at = tick()
    const issue: FakeIssue = {
      number,
      title,
      body,
      state: 'open',
      state_reason: null,
      labels: [],
      assignees: [],
      user: author,
      html_url: `https://github.com/${fullName}/issues/${number}`,
      created_at: at,
      updated_at: at,
    }
    r.issues.set(number, issue)
    return issue
  }
  function comment(fullName: string, issueNumber: number, author: GitHubUser, body: string) {
    const r = repos.get(fullName)!
    const id = nextCommentId++
    const at = tick()
    const created: FakeComment = {
      id,
      issueNumber,
      body,
      user: author,
      html_url: `https://github.com/${fullName}/issues/${issueNumber}#issuecomment-${id}`,
      created_at: at,
      updated_at: at,
    }
    r.comments.set(id, created)
    r.issues.get(issueNumber)!.updated_at = at
    return created
  }
  const issueJson = (r: FakeRepo, issue: FakeIssue) => ({
    ...issue,
    labels: issue.labels.map((name) => ({ name })),
    assignees: issue.assignees.map((login) => ({ login })),
    repository_url: `https://api.github.com/repos/${r.full_name}`,
  })
  const commentJson = (c: FakeComment) => {
    const { issueNumber: _issueNumber, ...rest } = c
    return rest
  }
  const notFound = () => Response.json({ message: 'Not Found' }, { status: 404 })

  function route(method: string, path: string, body: Record<string, unknown>): Response | null {
    const [pathname, query = ''] = path.split('?')
    if (method === 'GET' && pathname === '/user/repos')
      return Response.json(
        [...repos.values()].map((r) => ({ id: r.id, full_name: r.full_name, private: false }))
      )
    if (method === 'GET' && pathname === '/user') return Response.json(bot)
    if (method === 'DELETE' && /^\/applications\/[^/]+\/token$/.test(pathname))
      return new Response(null, { status: 204 })

    const m = /^\/repos\/([^/]+\/[^/]+)(\/.*)?$/.exec(pathname)
    const r = m ? repos.get(m[1]) : undefined
    if (!m || !r) return null
    const rest = m[2] ?? ''
    let match: RegExpExecArray | null

    // Hooks
    if (rest === '/hooks' && method === 'POST') {
      const config = body.config as { url: string; secret: string }
      const hook: FakeHook = {
        id: nextHookId++,
        events: body.events as string[],
        secret: config.secret,
        url: config.url,
      }
      r.hooks.set(hook.id, hook)
      return Response.json({ id: hook.id, events: hook.events }, { status: 201 })
    }
    if (rest === '/hooks' && method === 'GET')
      return Response.json([...r.hooks.values()].map((h) => ({ id: h.id, config: { url: h.url } })))
    if ((match = /^\/hooks\/(\d+)$/.exec(rest))) {
      const hook = r.hooks.get(Number(match[1]))
      if (!hook) return notFound()
      if (method === 'PATCH') {
        if (Array.isArray(body.events)) hook.events = body.events as string[]
        const config = body.config as { url?: string; secret?: string } | undefined
        if (config?.secret) hook.secret = config.secret
        if (config?.url) hook.url = config.url
        return Response.json({ id: hook.id, events: hook.events })
      }
      if (method === 'DELETE') {
        r.hooks.delete(hook.id)
        return new Response(null, { status: 204 })
      }
    }

    // Issues
    if (rest === '/issues' && method === 'POST') {
      const issue = openIssue(r.full_name, bot, String(body.title), String(body.body ?? ''))
      issue.labels = (body.labels as string[] | undefined) ?? []
      return Response.json(issueJson(r, issue), { status: 201 })
    }
    if ((match = /^\/issues\/(\d+)$/.exec(rest))) {
      const issue = r.issues.get(Number(match[1]))
      if (!issue) return notFound()
      if (method === 'PATCH') {
        if (typeof body.title === 'string') issue.title = body.title
        if (typeof body.body === 'string') issue.body = body.body
        if (body.state === 'open' || body.state === 'closed') issue.state = body.state
        if ('state_reason' in body) issue.state_reason = (body.state_reason as string) ?? null
        if (Array.isArray(body.labels)) issue.labels = body.labels as string[]
        if (Array.isArray(body.assignees)) issue.assignees = body.assignees as string[]
        issue.updated_at = tick()
      }
      if (method === 'GET' || method === 'PATCH') return Response.json(issueJson(r, issue))
    }
    if ((match = /^\/issues\/(\d+)\/comments$/.exec(rest))) {
      const number = Number(match[1])
      if (!r.issues.has(number)) return notFound()
      if (method === 'POST')
        return Response.json(commentJson(comment(r.full_name, number, bot, String(body.body))), {
          status: 201,
        })
      if (method === 'GET') {
        const since = new URLSearchParams(query).get('since')
        return Response.json(
          [...r.comments.values()]
            .filter((c) => c.issueNumber === number && (!since || c.updated_at >= since))
            .map(commentJson)
        )
      }
    }
    if ((match = /^\/issues\/comments\/(\d+)$/.exec(rest))) {
      const found = r.comments.get(Number(match[1]))
      if (!found) return notFound()
      if (method === 'PATCH') {
        found.body = String(body.body)
        found.updated_at = tick()
        return Response.json(commentJson(found))
      }
      if (method === 'DELETE') {
        r.comments.delete(found.id)
        return new Response(null, { status: 204 })
      }
      if (method === 'GET') return Response.json(commentJson(found))
    }
    if ((match = /^\/issues\/(\d+)\/labels$/.exec(rest)) && method === 'POST') {
      const issue = r.issues.get(Number(match[1]))
      if (!issue) return notFound()
      for (const label of (body.labels as string[]) ?? [])
        if (!issue.labels.includes(label)) issue.labels.push(label)
      issue.updated_at = tick()
      return Response.json(issue.labels.map((name) => ({ name })))
    }
    if ((match = /^\/issues\/(\d+)\/labels\/(.+)$/.exec(rest)) && method === 'DELETE') {
      const issue = r.issues.get(Number(match[1]))
      if (!issue) return notFound()
      issue.labels = issue.labels.filter((l) => l !== decodeURIComponent(match![2]))
      issue.updated_at = tick()
      return Response.json(issue.labels.map((name) => ({ name })))
    }
    if (rest === '/assignees' && method === 'GET') return Response.json([])
    return null
  }

  async function handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.origin !== 'https://api.github.com')
      throw new Error(`the round trip never leaves for ${url.origin}`)
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const path = `${url.pathname}${url.search}`
    const raw = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, path, ...(raw ? { body: raw } : {}) })
    const answer = route(method, path, raw ?? {})
    if (answer) return answer
    unhandled.push(`${method} ${path}`)
    return notFound()
  }

  /** The calls since `from` that change something on GitHub. */
  const writesSince = (from: number) =>
    calls
      .slice(from)
      .filter((c) => c.method !== 'GET')
      .map((c) => `${c.method} ${c.path}`)

  return { repos, calls, unhandled, repo, openIssue, comment, handle, writesSince, tick }
}

// ============================================================================
// The round trip
// ============================================================================

describe.skipIf(!fixture.available)('GitHub round trip across two repositories (real DB)', () => {
  const bot = { id: 1, login: 'acme-bot' }
  const customer = { id: 77, login: 'casey-customer' }
  const developer = { id: 42, login: 'octo-dev' }
  const github = fakeGitHub(bot)
  github.repo('acme/app', 101)
  github.repo('acme/api', 102)

  /** What the steps hand each other. */
  const state = {} as {
    integrationId: (typeof integrations.$inferSelect)['id']
    servicePrincipal: PrincipalId
    agent: Actor
    supportTeamId: string
    bugTypeId: string
    appRepoId: string
    apiRepoId: string
    appTicketId: TicketId
    apiTicketId: TicketId
    replyId: string
    replyCommentId: number
  }

  beforeAll(async () => {
    await fixture.begin()
    vi.spyOn(globalThis, 'fetch').mockImplementation(github.handle)
  })
  afterEach(() => {
    // Every call the sync made is one this GitHub knows.
    expect(github.unhandled).toEqual([])
  })
  afterAll(async () => {
    vi.restoreAllMocks()
    await fixture.rollback()
    await fixture.close()
  })

  // --------------------------------------------------------------------------
  // Running the work a commit would wake, as the job worker does
  // --------------------------------------------------------------------------

  const dispatched = new Set<string>()
  const attempts = new Map<string, number>()

  /**
   * Dispatch every event written so far and run every queued sync operation,
   * repeating until three rounds in a row find nothing: services emit their
   * events after their write returns, and one operation may queue the next.
   */
  async function settle() {
    let quiet = 0
    for (let round = 0; round < 200 && quiet < 3; round++) {
      await new Promise((resolve) => setTimeout(resolve, 15))
      let worked = false
      const jobs = getExecuteRows<{
        id: string
        job_id: string
        payload: Record<string, unknown>
        attempts: number
        max_attempts: number
      }>(
        await testDb.execute(
          sql`SELECT id::text, job_id, payload, attempts, max_attempts FROM job_queue
              WHERE queue = 'event-dispatch' AND status = 'pending' ORDER BY id`
        )
      ).filter((job) => !dispatched.has(job.job_id))
      for (const job of jobs) {
        dispatched.add(job.job_id)
        const claimed: ClaimedJob = {
          id: job.id,
          jobId: job.job_id,
          queue: 'event-dispatch',
          dedupeKey: null,
          payload: job.payload,
          workspaceKey: null,
          attempts: job.attempts + 1,
          maxAttempts: job.max_attempts,
          leaseToken: randomUUID(),
          lockedUntil: new Date(Date.now() + 60_000),
          runAt: new Date(),
        }
        await runEventDispatch(claimed)
        await testDb.execute(
          sql`UPDATE job_queue SET status = 'succeeded', finished_at = now() WHERE job_id = ${job.job_id}`
        )
        worked = true
      }
      const queued = await testDb
        .select({ id: operations.id })
        .from(operations)
        .where(eq(operations.state, 'queued'))
      for (const op of queued) {
        const tries = attempts.get(op.id) ?? 0
        if (tries >= 3) continue
        attempts.set(op.id, tries + 1)
        try {
          await runIntegrationSync(syncTestJob(op.id))
        } catch {
          // A retry is the job queue's to schedule; the operation records it.
        }
        worked = true
      }
      quiet = worked ? 0 : quiet + 1
    }
  }

  const sign = (secret: string, body: string) =>
    `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

  /** POST a delivery to the webhook endpoint as GitHub would, signed with `secret`. */
  async function deliver(event: string, payload: Record<string, unknown>, secret: string) {
    const body = JSON.stringify(payload)
    return handleInboundWebhook(
      new Request('https://help.acme.test/api/integrations/github/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Event': event,
          'X-GitHub-Delivery': randomUUID(),
          'X-Hub-Signature-256': sign(secret, body),
        },
        body,
      }),
      'github'
    )
  }

  /** A delivery signed with the repository's own secret, as its hook sends it. */
  async function deliverFrom(fullName: string, event: string, payload: Record<string, unknown>) {
    const [hook] = github.repos.get(fullName)!.hooks.values()
    return deliver(event, payload, hook.secret)
  }

  const repository = (fullName: string) => ({
    full_name: fullName,
    id: github.repos.get(fullName)!.id,
  })
  const issuePayload = (
    fullName: string,
    action: string,
    issue: FakeIssue,
    sender: GitHubUser
  ) => ({
    action,
    repository: repository(fullName),
    sender,
    issue: { ...issue, labels: [], assignees: [] },
  })
  const commentPayload = (
    fullName: string,
    action: string,
    issue: FakeIssue,
    comment: FakeComment,
    sender: GitHubUser
  ) => ({
    action,
    repository: repository(fullName),
    sender,
    issue: { ...issue, labels: [], assignees: [] },
    comment: (({ issueNumber: _n, ...rest }) => rest)(comment),
  })

  const messagesOf = (ticketId: TicketId) =>
    testDb.query.conversationMessages.findMany({
      where: eq(conversationMessages.ticketId, ticketId),
      orderBy: (m, { asc }) => [asc(m.createdAt), asc(m.id)],
    })
  const statusId = async (slug: string) =>
    (await testDb.query.ticketStatuses.findFirst({ where: eq(ticketStatuses.slug, slug) }))!
      .id as TicketStatusId
  const ticketRow = async (id: TicketId) =>
    (await testDb.query.tickets.findFirst({ where: eq(tickets.id, id) }))!

  // --------------------------------------------------------------------------

  it('a. connecting gives each repository its own hook and secret', async () => {
    await testDb
      .insert(settings)
      .values({ name: 'Acme', slug: `acme-${unique()}`, createdAt: new Date() })
    await testDb.insert(user).values({ id: ADMIN_USER_ID as never, name: 'Admin' })
    const servicePrincipal = createId('principal') as PrincipalId
    await testDb.insert(principal).values({
      id: servicePrincipal,
      type: 'service',
      role: 'member',
      displayName: 'GitHub',
      createdAt: new Date(),
    })
    // The connection as OAuth saves it, with status sync on: every
    // repository's hook is wanted.
    const [integration] = await testDb
      .insert(integrations)
      .values({
        integrationType: 'github',
        status: 'active',
        principalId: servicePrincipal,
        config: { username: bot.login, statusSyncEnabled: true },
        secrets: encryptSecrets({ accessToken: 'gho_round_trip' }),
      })
      .returning()

    const app = await addDestination({
      integrationType: 'github',
      kind: 'repo',
      externalId: 'acme/app',
    })
    const api = await addDestination({
      integrationType: 'github',
      kind: 'repo',
      externalId: 'ACME/api',
    })

    for (const [row, fullName] of [
      [app, 'acme/app'],
      [api, 'acme/api'],
    ] as const) {
      const hooks = [...github.repos.get(fullName)!.hooks.values()]
      expect(hooks).toHaveLength(1)
      expect(hooks[0].url).toBe('https://help.acme.test/api/integrations/github/webhook')
      expect(row).toMatchObject({
        externalId: fullName,
        externalKey: String(github.repos.get(fullName)!.id),
        externalWebhookId: String(hooks[0].id),
      })
      // The secret GitHub signs with is the one stored, encrypted, on the row.
      expect(readDestinationSecret(row)).toBe(hooks[0].secret)
    }
    expect(readDestinationSecret(app)).not.toBe(readDestinationSecret(api))
    // The first repository became the connection's default.
    expect(
      (await testDb.query.integrations.findFirst({ where: eq(integrations.id, integration.id) }))
        ?.config
    ).toMatchObject({ channelId: 'acme/app' })

    const [agentUser] = await testDb
      .insert(user)
      .values({ name: 'Jane Agent', email: `jane-${unique()}@example.test` })
      .returning()
    const [agentPrincipal] = await testDb
      .insert(principal)
      .values({
        userId: agentUser.id,
        type: 'user',
        role: 'admin',
        displayName: 'Jane Agent',
        createdAt: new Date(),
      })
      .returning()
    Object.assign(state, {
      integrationId: integration.id,
      servicePrincipal,
      appRepoId: app.id,
      apiRepoId: api.id,
      agent: {
        principalId: agentPrincipal.id,
        role: 'admin',
        principalType: 'user',
        segmentIds: new Set(),
        permissions: resolveActorPermissions('admin'),
      } satisfies Actor,
    })
  })

  it('b. a signed issue on acme/app opens an inbox conversation and a ticket for its team', async () => {
    // The inbox channel is on, and acme/app brings its issues in as tickets for Support.
    await testDb.insert(teams).values({ name: `Inbox ${unique()}`, isDefault: true })
    await ensureGitHubConnectionAccount(state.integrationId)
    const [support] = await testDb
      .insert(teams)
      .values({ name: `Support ${unique()}` })
      .returning()
    state.supportTeamId = support.id
    await updateDestinationConfig(state.appRepoId, {
      inboundMode: 'tickets',
      ticketScope: { teamId: support.id },
    })
    // Its hook now also carries comments, for the inbox thread.
    expect([...github.repos.get('acme/app')!.hooks.values()][0].events).toEqual([
      'issues',
      'issue_comment',
    ])

    const issue = github.openIssue('acme/app', customer, 'Export fails', 'Steps to reproduce.')
    const response = await deliverFrom(
      'acme/app',
      'issues',
      issuePayload('acme/app', 'opened', issue, customer)
    )
    expect(response.status).toBe(200)
    await settle()

    const [conversation] = await testDb
      .select()
      .from(conversations)
      .where(eq(conversations.channel, 'github'))
    expect(conversation.subject).toBe('Export fails')
    const [pair] = await testDb
      .select({ ticket: tickets })
      .from(ticketConversations)
      .innerJoin(tickets, eq(tickets.id, ticketConversations.ticketId))
      .where(eq(ticketConversations.conversationId, conversation.id))
    expect(pair.ticket).toMatchObject({
      type: 'customer',
      title: 'Export fails',
      assigneeTeamId: support.id,
      requesterPrincipalId: conversation.visitorPrincipalId,
    })
    state.appTicketId = pair.ticket.id

    // A delivery naming a repository this connection does not sync is refused unread.
    const stranger = await deliver(
      'issues',
      {
        ...issuePayload('acme/app', 'opened', issue, customer),
        repository: { full_name: 'acme/other', id: 999 },
      },
      [...github.repos.get('acme/app')!.hooks.values()][0].secret
    )
    expect(stranger.status).toBe(404)
    // One signed with another repository's secret is not acme/app's.
    const forged = await deliver(
      'issues',
      issuePayload('acme/app', 'edited', { ...issue, title: 'Forged' }, customer),
      [...github.repos.get('acme/api')!.hooks.values()][0].secret
    )
    expect(forged.status).toBe(401)
    await settle()
    expect((await ticketRow(state.appTicketId)).title).toBe('Export fails')
    expect(await testDb.select().from(conversations)).toHaveLength(1)
  })

  it('c. a matching ticket opens exactly one issue, on acme/api only', async () => {
    const [bug] = await testDb
      .insert(ticketTypes)
      .values({ name: 'Bug', slug: `bug_${unique()}`, category: 'customer' })
      .returning()
    state.bugTypeId = bug.id
    // acme/api only sends, and opens an issue for every new bug ticket.
    await updateDestinationConfig(state.apiRepoId, { direction: 'outbound' })
    await setDestinationTicketIssues(state.apiRepoId, {
      enabled: true,
      teamIds: [],
      ticketTypeIds: [bug.id],
    })
    const appIssuesBefore = github.repos.get('acme/app')!.issues.size

    const ticket = await createTicket(
      { title: 'Exports stop at 10k rows', ticketTypeId: bug.id, priority: 'high' },
      state.agent
    )
    state.apiTicketId = ticket.id as TicketId
    await settle()

    const issues = [...github.repos.get('acme/api')!.issues.values()]
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ number: 1, title: 'Exports stop at 10k rows', user: bot })
    expect(issues[0].body).toContain(
      `<!-- quackback:ticket-issue ticketId=${ticket.id} integrationId=${state.integrationId} -->`
    )
    expect(issues[0].labels).toContain('priority:high')
    const links = await testDb
      .select()
      .from(ticketExternalLinks)
      .where(eq(ticketExternalLinks.ticketId, state.apiTicketId))
    expect(links).toMatchObject([
      { externalId: '1', externalDisplayId: 'acme/api#1', status: 'active' },
    ])
    expect(github.repos.get('acme/app')!.issues.size).toBe(appIssuesBefore)
    expect(
      github.calls.filter((c) => c.method === 'POST' && c.path === '/repos/acme/app/issues')
    ).toEqual([])

    // A ticket of another type matches nothing.
    await createTicket({ title: 'How do I export?' }, state.agent)
    await settle()
    expect(github.repos.get('acme/api')!.issues.size).toBe(1)
  })

  it('d. a public reply becomes one comment that follows its edit and deletion; a note stays home', async () => {
    await updateDestinationConfig(state.apiRepoId, { postRepliesAsComments: true })
    const comments = () => [...github.repos.get('acme/api')!.comments.values()]

    const { message } = await sendTicketMessage(state.agent, {
      ticketId: state.apiTicketId,
      content: 'We can reproduce this and are on it.',
    })
    await settle()
    expect(comments()).toHaveLength(1)
    const [posted] = comments()
    expect(posted).toMatchObject({ issueNumber: 1, user: bot })
    expect(posted.body).toContain('We can reproduce this and are on it.')
    expect(posted.body).toContain(
      `<!-- quackback:ticket-comment messageId=${message.id} integrationId=${state.integrationId} -->`
    )
    expect(
      await testDb.query.messageExternalLinks.findMany({
        where: eq(messageExternalLinks.messageId, message.id as never),
      })
    ).toMatchObject([{ externalId: String(posted.id), direction: 'outbound', status: 'active' }])

    let from = github.calls.length
    await addTicketNote(state.agent, {
      ticketId: state.apiTicketId,
      content: 'PRIVATE: the customer is on the enterprise plan.',
    })
    await settle()
    expect(github.writesSince(from)).toEqual([])

    from = github.calls.length
    await editConversationMessage(
      message.id as never,
      'We can reproduce this; a fix ships in 2.4.1.',
      null,
      state.agent
    )
    await settle()
    expect(github.writesSince(from)).toEqual([`PATCH /repos/acme/api/issues/comments/${posted.id}`])
    expect(comments()[0].body).toContain('a fix ships in 2.4.1.')

    from = github.calls.length
    await deleteConversationMessage(message.id as never, state.agent)
    await settle()
    expect(github.writesSince(from)).toEqual([
      `DELETE /repos/acme/api/issues/comments/${posted.id}`,
    ])
    expect(comments()).toEqual([])
    expect(
      await testDb.query.messageExternalLinks.findMany({
        where: eq(messageExternalLinks.messageId, message.id as never),
      })
    ).toMatchObject([{ status: 'deleted' }])
  })

  it('e. a comment on the linked issue becomes a note; our own echo and the note go nowhere', async () => {
    await updateDestinationConfig(state.apiRepoId, { direction: 'both', commentVisibility: 'note' })
    expect([...github.repos.get('acme/api')!.hooks.values()][0].events).toEqual([
      'issues',
      'issue_comment',
    ])
    const issue = github.repos.get('acme/api')!.issues.get(1)!
    const before = (await messagesOf(state.apiTicketId)).length

    let from = github.calls.length
    const remark = github.comment('acme/api', 1, developer, 'Root cause is the CSV **streamer**.')
    const response = await deliverFrom(
      'acme/api',
      'issue_comment',
      commentPayload('acme/api', 'created', issue, remark, developer)
    )
    expect(response.status).toBe(200)
    await settle()
    const after = await messagesOf(state.apiTicketId)
    expect(after).toHaveLength(before + 1)
    const note = after.at(-1)!
    expect(note).toMatchObject({
      isInternal: true,
      senderType: 'agent',
      principalId: state.servicePrincipal,
    })
    expect(note.content).toContain('GitHub comment from @octo-dev')
    expect(note.content).toContain('Root cause is the CSV streamer.')
    expect(
      await testDb.query.messageExternalLinks.findMany({
        where: eq(messageExternalLinks.messageId, note.id),
      })
    ).toMatchObject([{ externalId: String(remark.id), direction: 'inbound' }])
    // The mirrored note is not posted back.
    expect(github.writesSince(from)).toEqual([])

    // A reply of ours, posted as a comment, then echoed back by GitHub.
    const { message } = await sendTicketMessage(state.agent, {
      ticketId: state.apiTicketId,
      content: 'Fixed in 2.4.1.',
    })
    await settle()
    const ours = [...github.repos.get('acme/api')!.comments.values()].at(-1)!
    expect(ours.body).toContain(`messageId=${message.id}`)
    const count = (await messagesOf(state.apiTicketId)).length
    from = github.calls.length
    const echo = await deliverFrom(
      'acme/api',
      'issue_comment',
      commentPayload('acme/api', 'created', issue, ours, bot)
    )
    expect(echo.status).toBe(200)
    await settle()
    expect(await messagesOf(state.apiTicketId)).toHaveLength(count)
    expect(github.writesSince(from)).toEqual([])
  })

  it('f. closing acme/app#1 moves only the ticket linked in acme/app, not the acme/api#1 one', async () => {
    const appIssue = github.repos.get('acme/app')!.issues.get(1)!
    const apiIssue = github.repos.get('acme/api')!.issues.get(1)!
    expect(apiIssue.number).toBe(appIssue.number)
    const apiBefore = await ticketRow(state.apiTicketId)
    const [apiLinkBefore] = await testDb
      .select()
      .from(ticketExternalLinks)
      .where(eq(ticketExternalLinks.ticketId, state.apiTicketId))

    appIssue.state = 'closed'
    appIssue.state_reason = 'completed'
    appIssue.updated_at = github.tick()
    const from = github.calls.length
    const response = await deliverFrom(
      'acme/app',
      'issues',
      issuePayload('acme/app', 'closed', appIssue, customer)
    )
    expect(response.status).toBe(200)
    await settle()

    expect((await ticketRow(state.appTicketId)).statusId).toBe(await statusId('resolved'))
    const apiAfter = await ticketRow(state.apiTicketId)
    expect(apiAfter.statusId).toBe(apiBefore.statusId)
    expect(apiAfter.resolvedAt).toBeNull()
    const [apiLinkAfter] = await testDb
      .select()
      .from(ticketExternalLinks)
      .where(eq(ticketExternalLinks.ticketId, state.apiTicketId))
    expect(apiLinkAfter).toMatchObject({
      status: 'active',
      remoteState: apiLinkBefore.remoteState,
    })
    // Nothing went back to either issue.
    expect(github.writesSince(from)).toEqual([])
    expect(apiIssue.state).toBe('open')

    // No sync operation touched the acme/api ticket for this delivery.
    const touched = await testDb
      .select()
      .from(operations)
      .where(and(eq(operations.kind, 'status'), eq(operations.sourceId, state.apiTicketId)))
    expect(touched).toEqual([])
  })

  it('g. disconnecting removes both repository hooks before revoking the token', async () => {
    await savePlatformCredentials({
      integrationType: 'github',
      credentials: { clientId: 'cid', clientSecret: 'csecret' },
      principalId: state.agent.principalId!,
    })
    const hookIds = ['acme/app', 'acme/api'].map(
      (name) => [...github.repos.get(name)!.hooks.keys()][0]
    )
    const from = github.calls.length

    await deleteIntegrationFn({ data: { id: state.integrationId } })

    expect(github.writesSince(from)).toEqual([
      `DELETE /repos/acme/app/hooks/${hookIds[0]}`,
      `DELETE /repos/acme/api/hooks/${hookIds[1]}`,
      'DELETE /applications/cid/token',
    ])
    expect(github.calls.at(-1)?.body).toEqual({ access_token: 'gho_round_trip' })
    for (const name of ['acme/app', 'acme/api']) expect(github.repos.get(name)!.hooks.size).toBe(0)
    expect(
      await testDb.query.integrations.findFirst({ where: eq(integrations.id, state.integrationId) })
    ).toBeUndefined()
    expect(
      await testDb
        .select()
        .from(integrationDestinations)
        .where(eq(integrationDestinations.integrationId, state.integrationId))
    ).toEqual([])
  })
})
