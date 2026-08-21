/**
 * Real-time fan-out bus for conversations, on Postgres `LISTEN`/`NOTIFY`.
 *
 * Postgres is the durable source of truth; this layer is fire-and-forget
 * delivery only. A message written on one app replica must reach an SSE
 * connection pinned to another replica. Redis pub/sub did that; `pg_notify`
 * does it now, from the tenant's own database.
 *
 * ## Three differences from the Redis version, all deliberate
 *
 * **One wire channel per database, logical channels inside the payload.**
 * A NOTIFY channel is an identifier capped at 63 bytes, and
 * `conversation:<uuid>` under a tenant prefix does not fit. So every message
 * travels on `quackback_realtime` and names its logical channel in the
 * envelope. Every subscriber on a replica sees its own tenant's whole realtime
 * stream and filters in process — which is what the previous in-process
 * listener registry already did, one level down.
 *
 * **Oversized payloads spill to a row.** `pg_notify` caps a payload at 8000
 * bytes; Redis PUBLISH had no such limit, and a conversation event carrying a
 * long message body can exceed it. Dropping the event would be a message the
 * agent never sees, so it is written to `realtime_overflow` and the NOTIFY
 * carries the row id. Steady state on a normal install is zero rows.
 *
 * **The subscriber connection is direct, and per tenant.** `LISTEN` through a
 * transaction-mode pooler registers and never delivers (measured). See
 * `pg-listener.ts` for the connection, and for why it is verified by a real
 * notify round trip rather than by reading `pg_listening_channels()`.
 *
 * ## Tenant isolation
 *
 * Stated three times, on purpose. The in-process registry is keyed by
 * `(tenant namespace, logical channel)`; each tenant's messages arrive on that
 * tenant's own connection to that tenant's own database; and every envelope
 * names its publishing tenant, which `dispatch` refuses if it disagrees with the
 * connection.
 *
 * The third one is not decoration. Without it the whole property rested on the
 * database boundary, and `pubsub.db.test.ts` proved that is not enough: two
 * scopes on one database delivered one tenant's inbox events to the other's
 * subscriber. That configuration is not supposed to exist, which is exactly why
 * nothing else would have caught it.
 */
import { sql } from 'drizzle-orm'
import { config } from '../config'
import { db } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { currentTenantNamespace } from '../tenancy/tenant-keyed'
import { getTenantScope } from '../tenancy/tenant-context'
import { isPooledTenancy } from '../tenancy/mode'
import { assertTenantDirectDatabase, resolveTenantPassword } from '../tenancy/pool-cache'
import type { Sql as PgSql } from 'postgres'
import { openRealtimeListener, type RealtimeListener } from './pg-listener'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'pubsub' })

/**
 * `pg_notify`'s hard limit is 8000 bytes; leave room for the envelope's own
 * braces and key names so the check is on the thing actually sent.
 */
const NOTIFY_PAYLOAD_LIMIT = 7_800

/** How long an overflow row is readable before the sweeper reclaims it. */
const OVERFLOW_TTL_SECONDS = 60

/**
 * Wire envelope. `t` is the publishing tenant, `c` the logical channel, `p` the
 * payload inline, `o` the id of an overflow row when the payload was too large.
 *
 * `t` is the second, independent statement of the tenant — the same redundancy
 * `kv_store.tenant_id` carries next to the database boundary, and it is here
 * because the first version of this file did NOT have it. With isolation resting
 * on the database boundary alone, two scopes sharing one database (a
 * single-tenant install, a misconfigured registry record, a test) delivered one
 * tenant's inbox events to the other's subscriber. Measured, not imagined:
 * `pubsub.db.test.ts`'s cross-tenant case failed before this field existed.
 */
interface Envelope {
  t: string
  c: string
  p?: unknown
  o?: string
}

type Handler = (message: string) => void

/**
 * `(tenantNamespace, logical channel)` -> in-process handlers.
 *
 * A plain Map rather than a `TenantKeyedCache`: that class is a bounded LRU, and
 * evicting a live SSE stream's handler because 5,000 other entries arrived would
 * silently stop delivering to a connection that is still open. Bounded by the
 * number of live SSE streams on this replica, which is bounded by the
 * connection limiter in `realtime/stream-connection-limit.ts`.
 */
const listeners = new Map<string, Set<Handler>>()

interface TenantConnection {
  listener: RealtimeListener
  /** Number of registered handlers across all of this tenant's channels. */
  refs: number
}

/**
 * Tenant namespace -> its dedicated LISTEN connection. Same reasoning as
 * `listeners`: an LRU here would close a connection out from under live
 * streams. Entries are removed when the last handler for that tenant leaves.
 */
const connections = new Map<string, TenantConnection>()

/** In-flight opens, so N concurrent subscribes share one connection. */
const opening = new Map<string, Promise<TenantConnection>>()

function registryKey(namespace: string, channel: string): string {
  // NUL cannot occur in a tenant id or a channel name, so no two pairs can
  // compose to the same string. Same reasoning as `TenantKeyedCache.SEPARATOR`.
  return `${namespace}\u0000${channel}`
}

function dispatch(namespace: string, listener: RealtimeListener, raw: string): void {
  let envelope: Envelope
  try {
    envelope = JSON.parse(raw) as Envelope
  } catch (err) {
    log.warn({ err }, 'undecodable realtime payload')
    return
  }
  if (typeof envelope.c !== 'string') return

  // The connection's own tenant is the authority. A message that names a
  // different one arrived on a database this tenant should not be sharing, and
  // delivering it would put another workspace's conversation on this agent's
  // inbox stream. Refuse loudly rather than filter quietly.
  if (envelope.t !== namespace) {
    log.error(
      { expected: namespace, received: envelope.t, channel: envelope.c },
      'refusing a realtime message published under a different tenant'
    )
    return
  }

  const handlers = listeners.get(registryKey(namespace, envelope.c))
  if (!handlers || handlers.size === 0) return

  if (typeof envelope.o === 'string') {
    // Oversized: the body is in a row, read back on the listener's own
    // connection. Several replicas may each need it, so the reader must not
    // delete it — the sweeper reclaims it.
    void listener
      .fetchOverflow(namespace, envelope.o)
      .then((body) => {
        if (body === null) return
        emit(handlers, JSON.stringify(body))
      })
      .catch((err) => log.warn({ err }, 'overflow fetch failed'))
    return
  }

  emit(handlers, JSON.stringify(envelope.p ?? null))
}

function emit(handlers: Set<Handler>, message: string): void {
  for (const fn of handlers) {
    try {
      fn(message)
    } catch (err) {
      log.error({ err }, 'listener threw')
    }
  }
}

/**
 * The direct DSN for the active tenant.
 *
 * Single-tenant installs use `DATABASE_URL`, which for a self-hosted deployment
 * already is a direct session-mode connection. Pooled installs must reach for
 * the registry's `directUrl` — the pooled URL would register the LISTEN and
 * deliver nothing.
 */
async function directConnection(): Promise<{
  url: string
  password?: () => Promise<string>
  verifyIdentity?: (sql: PgSql) => Promise<void>
}> {
  if (!isPooledTenancy()) return { url: config.databaseUrl }
  const scope = getTenantScope()
  if (!scope) {
    throw new Error(
      'realtime subscribe requires a tenant scope under QUACKBACK_TENANCY=pooled: ' +
        "the LISTEN connection is built from this tenant's direct DSN."
    )
  }
  const tenant = scope.tenant
  return {
    url: tenant.database.directUrl,
    password: () => resolveTenantPassword(tenant),
    // The pool cache's own fail-closed identity assertion, run on the listener
    // connection before anything is delivered: the direct path must not be
    // weaker than the request path it rides beside.
    verifyIdentity: (sql) => assertTenantDirectDatabase(tenant, sql),
  }
}

async function acquireConnection(namespace: string): Promise<TenantConnection> {
  const existing = connections.get(namespace)
  if (existing) {
    existing.refs += 1
    return existing
  }
  const inFlight = opening.get(namespace)
  if (inFlight) {
    const conn = await inFlight
    conn.refs += 1
    return conn
  }

  const promise = (async () => {
    const { url, password, verifyIdentity } = await directConnection()
    // `dispatch` needs the listener to read overflow rows back on its own
    // connection, and the listener needs `onPayload` to construct. The box
    // closes the cycle without a partially-initialised binding.
    const box: { listener: RealtimeListener | null } = { listener: null }
    const listener = await openRealtimeListener({
      directUrl: url,
      password,
      verifyIdentity,
      label: namespace,
      onPayload: (raw) => {
        if (box.listener) dispatch(namespace, box.listener, raw)
      },
    })
    box.listener = listener
    // Deliberately not awaited: the check exists to make a misconfigured DSN
    // loud, not to gate the stream. A listener pointed at a transaction-mode
    // pooler accepts the LISTEN and silently delivers nothing — verify() is
    // the only check that catches it, and it must not delay the first stream.
    void listener
      .verify()
      .catch((err) => log.warn({ err, namespace }, 'could not verify the realtime listener'))
    const conn: TenantConnection = { listener, refs: 0 }
    connections.set(namespace, conn)
    return conn
  })()

  opening.set(namespace, promise)
  try {
    const conn = await promise
    conn.refs += 1
    return conn
  } finally {
    opening.delete(namespace)
  }
}

async function releaseConnection(namespace: string): Promise<void> {
  const conn = connections.get(namespace)
  if (!conn) return
  conn.refs -= 1
  if (conn.refs > 0) return
  connections.delete(namespace)
  await conn.listener.close().catch((err) => log.warn({ err }, 'listener close failed'))
}

/**
 * Subscribe to one or more channels. The handler is invoked with the raw
 * string payload for every published message on any of those channels.
 * Returns an async unsubscribe function that removes this handler and drops
 * the underlying connection once no listeners remain for the tenant.
 *
 * The tenant namespace is captured HERE, while the request scope that named it
 * is still open — an SSE stream outlives that scope by minutes, so a namespace
 * read at delivery time would read whatever request happened to be in flight.
 */
export async function subscribe(
  channels: string[],
  onMessage: (channel: string, message: string) => void
): Promise<() => Promise<void>> {
  const namespace = currentTenantNamespace()
  await acquireConnection(namespace)

  const registered: Array<{ key: string; fn: Handler }> = []
  for (const channel of channels) {
    const key = registryKey(namespace, channel)
    // The handler is told the logical name it asked for.
    const fn: Handler = (message: string) => onMessage(channel, message)
    let set = listeners.get(key)
    if (!set) {
      set = new Set()
      listeners.set(key, set)
    }
    set.add(fn)
    registered.push({ key, fn })
  }

  // One connection reference per subscribe() call, released once on unsubscribe,
  // so a caller that subscribes to three channels does not have to unsubscribe
  // three times for the connection to close.
  let released = false
  return async () => {
    for (const { key, fn } of registered) {
      const set = listeners.get(key)
      if (!set) continue
      set.delete(fn)
      if (set.size === 0) listeners.delete(key)
    }
    if (released) return
    released = true
    await releaseConnection(namespace)
  }
}

/**
 * Publish a payload to a channel. Fire-and-forget: a delivery failure must
 * never break the write that triggered it (the message is already committed
 * to Postgres).
 *
 * Not awaited by callers, so the promise is swallowed here rather than left to
 * become an unhandled rejection.
 */
export function publish(channel: string, payload: unknown): void {
  void publishAsync(channel, payload).catch((err) => log.warn({ err, channel }, 'publish failed'))
}

/** The awaitable form, for tests and for callers that want back-pressure. */
export async function publishAsync(channel: string, payload: unknown): Promise<void> {
  const namespace = currentTenantNamespace()
  const inline = JSON.stringify({ t: namespace, c: channel, p: payload } satisfies Envelope)
  if (Buffer.byteLength(inline, 'utf8') <= NOTIFY_PAYLOAD_LIMIT) {
    await db.execute(sql`SELECT pg_notify(${'quackback_realtime'}, ${inline})`)
    return
  }

  const result = await db.execute(sql`
    INSERT INTO realtime_overflow (tenant_id, channel, payload, expires_at)
    VALUES (
      ${namespace},
      ${channel},
      ${JSON.stringify(payload ?? null)}::jsonb,
      now() + make_interval(secs => ${OVERFLOW_TTL_SECONDS})
    )
    RETURNING id
  `)
  const rows = getExecuteRows<{ id: string | number | bigint }>(result)
  const id = rows[0]?.id
  if (id === undefined) throw new Error('realtime overflow insert returned no id')
  const envelope = JSON.stringify({ t: namespace, c: channel, o: String(id) } satisfies Envelope)
  await db.execute(sql`SELECT pg_notify(${'quackback_realtime'}, ${envelope})`)
}

/** Drain every listener connection on graceful shutdown. */
export async function closeSubscriber(): Promise<void> {
  const open = [...connections.values()]
  connections.clear()
  listeners.clear()
  await Promise.all(open.map((c) => c.listener.close().catch(() => {})))
}

/**
 * Test seam: how many dedicated LISTEN connections this process currently
 * holds. Exported so the connection-lifecycle test observes the real registry
 * rather than reconstructing it.
 */
export function openListenerCount(): number {
  return connections.size
}
