/**
 * The realtime bus's receive side — `LISTEN quackback_realtime` on a
 * session-mode connection.
 *
 * The discipline is the same one the job queue used to take, and the reason is the same
 * measurement: through a transaction-mode pooler a notify **never
 * arrives, at any concurrency — including a single client**, while
 * `pg_listening_channels()` reports the registration as held the whole time
 * (SAAS-HOSTING-STACK.md §7.3, measured 2026-08-08). So:
 *
 * 1. The connection is built from the workspace's **direct** DSN, never from the
 *    pool cache.
 * 2. A listener is only ever verified by round-tripping a real NOTIFY.
 *    `verify()` sends one from a *separate* connection and waits for it —
 *    nothing here asks the catalogue whether it is registered, and nothing
 *    should.
 *
 * ## One channel, not one per topic
 *
 * `pg_notify`'s channel is an identifier, capped at 63 bytes, and a logical
 * channel like `conversation:<uuid>` under a workspace prefix does not fit. So
 * every workspace database uses ONE channel and carries the logical channel inside
 * the payload. That also means one LISTEN per connection rather than one per
 * SSE stream, which is what keeps the connection count proportional to *workspaces
 * with live streams on this replica* rather than to streams.
 *
 * ## What this costs, stated plainly
 *
 * §7.3's warning is that a pooled process holding N permanent session
 * connections purely to receive notifies inverts the reason for pooling. That
 * warning applies to a process that listens for *every* workspace. This one opens
 * a connection when a workspace's first SSE stream arrives on this replica and
 * closes it when the last one leaves, so the bound is the number of workspaces
 * currently holding an SSE stream here — a resource that is already long-lived
 * and already proportional to the same thing.
 */
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'realtime-listen' })

/** The single NOTIFY channel per workspace database. */
export const REALTIME_CHANNEL = 'quackback_realtime'

export interface RealtimeListener {
  /**
   * Read an oversized payload back, **on this listener's own connection**.
   *
   * Deliberately not through `db`: a NOTIFY callback fires outside any request,
   * so there is no workspace scope to resolve a pooled handle from, and relying on
   * an ALS context that happened to survive into a socket callback would be an
   * accident rather than a design. This connection is already bound to exactly
   * the database the notify came from, which is the only correct source.
   */
  fetchOverflow(workspaceKey: string, id: string): Promise<unknown | null>
  /** Release the LISTEN and close the dedicated connection. */
  close(): Promise<void>
  /**
   * Prove the channel actually delivers, by sending a NOTIFY from a second
   * connection and waiting for it.
   *
   * Never replaced with a `pg_listening_channels()` check: that view reports the
   * registration as held on a pooled connection which delivers nothing.
   */
  verify(timeoutMs?: number): Promise<boolean>
}

export interface OpenRealtimeListenerInput {
  /** Direct (session-mode) DSN. A pooled DSN will register and never deliver. */
  directUrl: string
  /** Resolved per connection, so a rotated credential is picked up on reconnect. */
  password?: () => Promise<string>
  /** Called with the raw NOTIFY payload for every delivered message. */
  onPayload: (payload: string) => void
  /** Label for logs — the workspace id, or 'single'. */
  label: string
}

export async function openRealtimeListener(
  input: OpenRealtimeListenerInput
): Promise<RealtimeListener> {
  const sql: Sql = postgres(input.directUrl, {
    max: 1,
    // A bus that closes itself when idle is not a bus.
    idle_timeout: 0,
    connect_timeout: 15,
    ...(input.password ? { password: input.password } : {}),
    onnotice: () => {},
  })

  const verifyWaiters = new Set<(payload: string) => void>()

  await sql.listen(REALTIME_CHANNEL, (payload) => {
    for (const waiter of verifyWaiters) waiter(payload)
    input.onPayload(payload)
  })

  log.info({ workspace: input.label }, 'realtime listener attached (direct, session mode)')

  return {
    async fetchOverflow(workspaceKey: string, id: string) {
      const rows = await sql<{ payload: unknown }[]>`
        SELECT payload FROM realtime_overflow
        WHERE workspace_key = ${workspaceKey} AND id = ${id}::bigint AND expires_at > now()
      `
      return rows.length > 0 ? rows[0].payload : null
    },
    async close() {
      await sql.end({ timeout: 5 }).catch(() => {})
    },
    async verify(timeoutMs = 5_000) {
      const probe = `__verify__${Math.random().toString(36).slice(2, 10)}`
      const delivered = new Promise<boolean>((resolve) => {
        const waiter = (payload: string) => {
          if (payload !== probe) return
          verifyWaiters.delete(waiter)
          clearTimeout(timer)
          resolve(true)
        }
        const timer = setTimeout(() => {
          verifyWaiters.delete(waiter)
          resolve(false)
        }, timeoutMs)
        timer.unref?.()
        verifyWaiters.add(waiter)
      })
      // A separate connection sends it, so a delivery that only "works" because
      // the sender and the listener are the same session cannot pass.
      const sender = postgres(input.directUrl, {
        max: 1,
        connect_timeout: 15,
        ...(input.password ? { password: input.password } : {}),
        onnotice: () => {},
      })
      try {
        await sender`SELECT pg_notify(${REALTIME_CHANNEL}, ${probe})`
      } finally {
        await sender.end({ timeout: 5 }).catch(() => {})
      }
      const ok = await delivered
      if (!ok) {
        log.error(
          { workspace: input.label },
          'realtime listener did NOT receive its own probe notify — SSE streams on this ' +
            'replica will show nothing written on another replica. A pooled DSN produces ' +
            'exactly this: the registration is accepted and nothing is ever delivered.'
        )
      }
      return ok
    },
  }
}
