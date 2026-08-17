/**
 * The queue doorbell — `LISTEN quackback_job_wake` on a session-mode connection.
 *
 * ## This connection must not be pooled, and the reason is measured
 *
 * `LISTEN` needs a session-mode connection. Through Neon's transaction-mode
 * pooler a notify **never arrives, at any concurrency — including a single
 * client** (measured twice with two instruments, 2026-08-08). Worse,
 * `pg_listening_channels()` reports the registration as present the whole time,
 * so the obvious health check is a false green: it certifies a listener that
 * will never receive anything.
 *
 * Two consequences run through this file:
 *
 * 1. The connection is built from the workspace's **direct** DSN, not from the pool
 *    cache. A transaction-mode pooler registers LISTEN and delivers nothing.
 * 2. **A listener is only ever verified by round-tripping a real NOTIFY.**
 *    `verifyWake()` below sends one and waits for it. Nothing in this module
 *    asks the catalogue whether it is registered, and nothing should.
 *
 * The poll fallback in `tier.ts` is the correctness floor: if the doorbell is
 * lost, the queue is slower, not broken. That is deliberate — a lost wake
 * costs latency and never correctness.
 */
import postgres from 'postgres'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'job-wake' })

/** Channel name. Must match the trigger in migration 0253. */
export const JOB_WAKE_CHANNEL = 'quackback_job_wake'

/** `application_name` on every doorbell connection. Diagnostics, not behaviour. */
export const WAKE_APPLICATION_NAME = 'quackback-wake-listener'

export interface WakeListener {
  /** Release the LISTEN and close the dedicated connection. */
  close(): Promise<void>
  /**
   * Prove the channel actually delivers, by sending a NOTIFY and waiting for it.
   *
   * Never replaced with a `pg_listening_channels()` check: that view reports the
   * registration as held on a pooled connection which delivers nothing.
   */
  verify(timeoutMs?: number): Promise<boolean>
}

export interface OpenWakeListenerInput {
  /** Direct (session-mode) DSN. A pooled DSN will register and never deliver. */
  directUrl: string
  /** Channel to LISTEN on. Defaults to the job queue's. */
  channel?: string
  /** Resolved per connection, so a rotated credential is picked up on reconnect. */
  password?: () => Promise<string>
  /** Called on every notify, with the queue name the trigger sent. */
  onWake: (queue: string) => void
  /** Label for logs — the workspace id, or 'single'. */
  label: string
}

export async function openWakeListener(input: OpenWakeListenerInput): Promise<WakeListener> {
  const channel = input.channel ?? JOB_WAKE_CHANNEL
  const sql = postgres(input.directUrl, {
    max: 1,
    // A doorbell that closes itself when idle is not a doorbell.
    idle_timeout: 0,
    connect_timeout: 15,
    // Named so an operator can see the doorbells in `pg_stat_activity` and tell
    // them apart from query traffic. A connection that exists only to wait is
    // otherwise indistinguishable from one that is stuck.
    connection: { application_name: WAKE_APPLICATION_NAME },
    ...(input.password ? { password: input.password } : {}),
    onnotice: () => {},
  })

  const verifyWaiters = new Set<(payload: string) => void>()

  await sql.listen(channel, (payload) => {
    for (const waiter of verifyWaiters) waiter(payload)
    input.onWake(payload)
  })

  log.info({ workspace: input.label, channel }, 'wake listener attached (direct, session mode)')

  return {
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
        await sender`SELECT pg_notify(${channel}, ${probe})`
      } finally {
        await sender.end({ timeout: 5 }).catch(() => {})
      }
      const ok = await delivered
      if (!ok) {
        log.error(
          { workspace: input.label, channel },
          'wake listener did NOT receive its own probe notify — the queue is running on ' +
            'the poll fallback only. A pooled DSN produces exactly this: the registration is ' +
            'accepted and nothing is ever delivered.'
        )
      }
      return ok
    },
  }
}
