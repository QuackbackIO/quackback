/**
 * A chat stream outlives the workspace pool it checked out at start.
 *
 * Under pooled tenancy the pool cache ends a pool that has gone unused for
 * `WORKSPACE_POOL_IDLE_SECONDS`, or that the LRU cap pushes out, while a stream
 * opened on it is still live. Presence written through that pool afterwards
 * fails with `CONNECTION_ENDED`, the row goes stale past its TTL, and an online
 * agent drops out of routing. These cases prove the stream's heartbeat and
 * teardown still reach the presence row after that eviction.
 *
 * Real here: the route, the pool cache, the postgres.js driver, the resolver,
 * the presence SQL and the row it writes. Stood in for: the registry read and
 * the checks that identify a registered workspace database (fingerprint,
 * schema catch-up), because the test database is not one; and the route's
 * auth, feature gate and channel plumbing, which the presence scope never
 * reaches.
 */
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => {
  const url =
    process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/quackback_test'
  const parsed = new URL(url)
  const password = decodeURIComponent(parsed.password)
  parsed.password = ''
  vi.stubEnv('QUACKBACK_TENANCY', 'pooled')
  // Pooled mode refuses a fleet-wide DATABASE_URL; the pool cache reaches the
  // test database through the workspace descriptor instead.
  vi.stubEnv('DATABASE_URL', '')
  vi.stubEnv('BASE_URL', 'http://localhost:3000')
  vi.stubEnv('SECRET_KEY', 'a'.repeat(64))
  vi.stubEnv('QUACKBACK_CONTROL_DATABASE_URL', 'postgresql://u@localhost:5432/control')
  vi.stubEnv('QUACKBACK_TENANT_SECRET_DB', password)
  return { url, workspaceUrl: parsed.toString() }
})

const logged = vi.hoisted(() => [] as Array<{ level: string; obj: unknown; msg?: string }>)
const registryLookup = vi.hoisted(() => ({ gone: new Set<string>() }))
const heartbeatTicks = vi.hoisted(() => [] as Array<() => void>)
const requeued = vi.hoisted(() => [] as Array<{ principalId: string; poolAnswered: boolean }>)
const released = vi.hoisted(() => ({ count: 0 }))
const AGENT = vi.hoisted(() => 'principal_01streampooleviction')

vi.mock('@/lib/server/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/logger')>()
  const record =
    (level: string) =>
    (obj: unknown, msg?: string): void => {
      logged.push({ level, obj, msg })
    }
  const log: Record<string, unknown> = {
    trace: record('trace'),
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    fatal: record('fatal'),
  }
  log.child = () => log
  log.isLevelEnabled = () => false
  return { ...actual, logger: log }
})

vi.mock('@/lib/server/workspaces/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/workspaces/registry')>()
  const { makeWorkspaceDescriptor } = await import('@/lib/server/__tests__/workspace-scope')
  return {
    ...actual,
    resolveWorkspaceById: vi.fn(async (workspaceKey: string) => {
      if (registryLookup.gone.has(workspaceKey)) {
        return { kind: 'deleting', workspaceKey, hostname: `${workspaceKey}.example.com` }
      }
      const base = makeWorkspaceDescriptor(workspaceKey)
      return {
        kind: 'ok',
        workspace: {
          ...base,
          database: {
            ...base.database,
            pooledUrl: env.workspaceUrl,
            directUrl: env.workspaceUrl,
            credentialRef: 'env://QUACKBACK_TENANT_SECRET_DB',
          },
        },
      }
    }),
  }
})

vi.mock('@/lib/server/workspaces/fingerprint', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  observeWorkspaceIdentity: vi.fn(async () => ({
    selfReportedWorkspaceId: 'w',
    stampSource: 'none',
    physical: { currentDatabase: null, catalogOid: null },
    secretCanary: null,
    storedCiphertext: { kind: 'absent', source: 'jwks.private_key', reason: 'no-row' },
  })),
  evaluateWorkspaceIdentity: vi.fn(() => ({ ok: true })),
  evaluateSecretKeyCanary: vi.fn(() => ({ ok: true })),
}))
vi.mock('@/lib/server/fleet/ensure-schema-current', () => ({
  ensureWorkspaceSchemaCurrent: vi.fn(async () => {}),
}))
vi.mock('@/lib/server/fleet/schema-floor', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  assertSchemaFloor: vi.fn(async () => {}),
}))

// The route's own read of the principal. Every other `db` access, presence
// included, goes to the real workspace pool.
vi.mock('@/lib/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/db')>()
  const query = {
    principal: {
      findFirst: async () => ({ id: AGENT, role: 'admin', type: 'user' }),
    },
  }
  return {
    ...actual,
    db: new Proxy(actual.db, {
      get: (target, prop) => (prop === 'query' ? query : Reflect.get(target, prop)),
    }),
  }
})

// The real heartbeat, driven by hand instead of by a 20 second interval. The
// tick is bound to the context it was scheduled in, as `setInterval` binds it,
// so it runs inside the request's captured workspace scope exactly as it would
// in production.
vi.mock('@/lib/server/realtime/stream-heartbeat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/realtime/stream-heartbeat')>()
  const { AsyncResource } = await import('node:async_hooks')
  return {
    ...actual,
    startStreamHeartbeat: (opts: Parameters<typeof actual.startStreamHeartbeat>[0]) =>
      actual.startStreamHeartbeat({
        ...opts,
        schedule: (tick) => {
          heartbeatTicks.push(AsyncResource.bind(tick))
          return { clear: () => {} }
        },
      }),
  }
})

vi.mock('@/lib/server/domains/conversation/conversation.service', () => ({
  requeueUnansweredOnAgentOffline: vi.fn(async (principalId: string) => {
    const { db, sql } = await import('@/lib/server/db')
    let poolAnswered = false
    try {
      await db.execute(sql`SELECT 1`)
      poolAnswered = true
    } catch {
      poolAnswered = false
    }
    requeued.push({ principalId, poolAnswered })
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/auth', () => ({ auth: { api: { getSession: vi.fn(async () => null) } } }))
vi.mock('@/lib/server/realtime/stream-token', () => ({
  verifyStreamToken: vi.fn(() => ({ principalId: AGENT, scope: 'dashboard' })),
}))
vi.mock('@/lib/server/domains/settings/settings.support', () => ({
  isConversationsEnabled: vi.fn(async () => true),
  isConversationsEnabledFor: vi.fn(async () => true),
  isSupportTicketsEnabled: vi.fn(async () => true),
}))
vi.mock('@/lib/server/realtime/pubsub', () => ({ subscribe: vi.fn(async () => async () => {}) }))
vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  conversationChannel: (id: string) => `conversation:${id}`,
  CONVERSATION_INBOX_CHANNEL: 'conversation:inbox',
  ticketChannel: (id: string) => `ticket:${id}`,
  parseConversationFrame: () => null,
  isOwnTyping: () => false,
}))
vi.mock('@/lib/server/domains/assistant/assistant-activity-snapshot', () => ({
  readActivitySnapshot: vi.fn(async () => null),
}))
vi.mock('@/lib/server/policy/conversation', () => ({ canViewConversation: vi.fn() }))
vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({ assertTicketVisible: vi.fn() }))
vi.mock('@/lib/server/domains/conversation/conversation.query', () => ({
  loadAuthors: vi.fn(async () => new Map()),
  toMessageDTO: vi.fn(),
  fallbackAuthor: vi.fn(),
  findBackfillCursor: vi.fn(),
}))
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  normalizePrincipalType: (t: string) => t,
}))
vi.mock('@/lib/server/realtime/stream-connection-limit', () => ({
  streamLimiter: {
    acquire: () => ({
      ok: true,
      release: () => {
        released.count += 1
      },
    }),
  },
}))
vi.mock('@/lib/server/domains/api/rate-limit', () => ({ getClientIp: () => '203.0.113.7' }))

import { Route } from '../stream'
import {
  acquireScopeForWorkspaceId,
  invalidateWorkspaceCache,
} from '@/lib/server/workspaces/resolver'
import { __resetPoolCacheForTests, sweepIdlePools } from '@/lib/server/workspaces/pool-cache'
import {
  runWithWorkspaceScope,
  type WorkspaceScope,
} from '@/lib/server/workspaces/workspace-context'
import { setWorkspaceSecretsResolver } from '@/lib/server/workspaces/workspace-secrets'
import { makeWorkspaceSecrets } from '@/lib/server/__tests__/workspace-scope'

type RouteOpts = { server: { handlers: { GET: (a: { request: Request }) => Promise<Response> } } }
const GET = (Route as unknown as { options: RouteOpts }).options.server.handlers.GET

/** An observer's own connection, outside the pool cache, so eviction cannot touch it. */
const observer = postgres(env.url, { max: 2, onnotice: () => {} })

async function presenceRows(workspaceKey: string) {
  return observer<{ stream_id: string; fresh: boolean }[]>`
    SELECT stream_id, heartbeat_at > now() - interval '1 minute' AS fresh
    FROM presence_stream
    WHERE workspace_key = ${workspaceKey} AND principal_id = ${AGENT}
  `
}

interface OpenStream {
  workspaceKey: string
  scope: WorkspaceScope
  controller: AbortController
  reader: ReadableStreamDefaultReader<Uint8Array>
}

/** Open a presence stream the way the request middleware would: inside a checked-out scope. */
async function openStream(): Promise<OpenStream> {
  const workspaceKey = `stream-evict-${randomUUID().slice(0, 8)}`
  const acquisition = await acquireScopeForWorkspaceId(workspaceKey, 'request')
  if (acquisition.kind !== 'ok') throw new Error(`fixture could not scope ${workspaceKey}`)
  const scope = acquisition.scope
  const controller = new AbortController()
  const request = new Request('http://test/api/chat/stream?scope=presence&token=t', {
    signal: controller.signal,
  })
  const res = await runWithWorkspaceScope(scope, () => GET({ request }))
  expect(res.status).toBe(200)
  const reader = res.body!.getReader()
  // Drain the connect frames so the next heartbeat ping lands in an empty
  // queue and reads as a live consumer.
  let frames = ''
  while (!frames.includes(': connected')) {
    const { value, done } = await reader.read()
    if (done) break
    frames += new TextDecoder().decode(value)
  }
  await vi.waitFor(async () => expect(await presenceRows(workspaceKey), warnings()).toHaveLength(1))
  await vi.waitFor(() => expect(heartbeatTicks).toHaveLength(1))
  return { workspaceKey, scope, controller, reader }
}

/** Evict every pool as the idle sweep would, and prove the stream's own pool is ended. */
async function evictStreamPool(stream: OpenStream): Promise<void> {
  expect(await sweepIdlePools(Date.now() + 3_600_000)).toBeGreaterThanOrEqual(1)
  await expect(stream.scope.sql`SELECT 1`).rejects.toThrow(/CONNECTION_ENDED/)
}

/** The warnings logged so far, with each error's cause, for a failure message. */
function warnings(): string {
  return JSON.stringify(
    logged
      .filter((l) => l.level === 'warn' || l.level === 'error')
      .map((l) => {
        const err = (l.obj as { err?: { cause?: unknown } } | undefined)?.err
        return { msg: l.msg, err: String(err ?? ''), cause: String(err?.cause ?? '') }
      })
  )
}

const opened: OpenStream[] = []

beforeAll(() => {
  setWorkspaceSecretsResolver((workspace) => makeWorkspaceSecrets(workspace.workspaceKey))
})

beforeEach(() => {
  logged.length = 0
  heartbeatTicks.length = 0
  requeued.length = 0
  registryLookup.gone.clear()
  released.count = 0
})

afterEach(async () => {
  for (const stream of opened.splice(0)) {
    await stream.reader.cancel().catch(() => {})
    await observer`DELETE FROM presence_stream WHERE workspace_key = ${stream.workspaceKey}`
  }
  await __resetPoolCacheForTests()
})

afterAll(async () => {
  setWorkspaceSecretsResolver(null)
  await observer.end({ timeout: 5 })
  vi.unstubAllEnvs()
})

describe('chat stream presence after its workspace pool is evicted', () => {
  it('refreshes the presence row on the next heartbeat', async () => {
    const stream = await openStream()
    opened.push(stream)
    await observer`
      UPDATE presence_stream SET heartbeat_at = now() - interval '10 minutes'
      WHERE workspace_key = ${stream.workspaceKey} AND principal_id = ${AGENT}
    `
    await evictStreamPool(stream)

    heartbeatTicks[0]()

    await vi.waitFor(
      async () => {
        const rows = await presenceRows(stream.workspaceKey)
        expect(rows, warnings()).toEqual([expect.objectContaining({ fresh: true })])
      },
      { timeout: 5_000 }
    )
  })

  it('clears the presence row and re-queues on a live pool when the stream closes', async () => {
    const stream = await openStream()
    opened.push(stream)
    await evictStreamPool(stream)

    // Aborted outside any scope, which is where the runtime fires the signal.
    stream.controller.abort()
    await vi.waitFor(() => expect(released.count).toBe(1))

    expect(await presenceRows(stream.workspaceKey), warnings()).toEqual([])
    expect(requeued).toEqual([{ principalId: AGENT, poolAnswered: true }])
  })

  it('logs and keeps the stream open when the workspace can no longer be opened', async () => {
    const stream = await openStream()
    opened.push(stream)
    await evictStreamPool(stream)
    registryLookup.gone.add(stream.workspaceKey)
    invalidateWorkspaceCache(stream.workspaceKey)

    heartbeatTicks[0]()

    await vi.waitFor(() =>
      expect(logged).toContainEqual(
        expect.objectContaining({
          level: 'warn',
          obj: expect.objectContaining({
            err: expect.objectContaining({ name: 'WorkspaceScopeUnavailableError' }),
          }),
        })
      )
    )
    // Still live: the next heartbeat pings rather than tearing the stream down.
    await stream.reader.read()
    heartbeatTicks[0]()
    const { value } = await stream.reader.read()
    expect(new TextDecoder().decode(value)).toContain(': ping')
    expect(released.count).toBe(0)
  })
})
