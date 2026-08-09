/**
 * Refusing a pooled DSN where a session-mode connection is required.
 *
 * ## Why this is a guard and not a nicety
 *
 * The relay tier's doorbell and its leadership both need a session-mode
 * connection, and the failure when they do not get one is **silent**. Measured on
 * Neon by delivery — never by `pg_listening_channels()`, which for this channel
 * is not merely a false green but *inverted*:
 *
 * | concurrent listeners | pooled | direct |
 * | --- | --- | --- |
 * | 1 | **0/1, across 16 runs** | 1/1 |
 * | 6 | 0/6 | 6/6 |
 * | 10 | 0/10 | 10/10 |
 *
 * Hunted specifically for a shape that would deliver: the notify issued on the
 * pooled endpoint with the notifier backend pid held constant so same-backend
 * routing was available; a self-notify from the same `postgres.js` instance
 * holding the `LISTEN`; `LISTEN "c"; NOTIFY "c";` in one simple-protocol batch on
 * one socket; 25 concurrent pooled senders against a single idle listener. **Zero
 * delivered on pooled in every case.**
 *
 * That makes it a hard impossibility at one idle client, not a loss that grows
 * with contention — so a one-connection smoke test does **not** pass on a pooler,
 * and "the relay must run on direct connections" is a structural requirement
 * rather than a tuning preference.
 *
 * A registry record whose `db_direct_url` is in fact the pooled endpoint is one
 * character of difference and produces a relay that registers its doorbell,
 * receives nothing forever, and falls back to polling without anyone noticing.
 * The boot probe in `relay-tier.ts` catches that after the fact, by round-tripping
 * a real NOTIFY. This catches it *before* the connection is opened, and names the
 * field to fix.
 *
 * ## Why it warns rather than throws
 *
 * The check is a **hostname heuristic** — Neon spells its pooled endpoint
 * `<endpoint>-pooler.<region>...`, and PgBouncer in front of a self-hosted
 * Postgres has no distinguishing name at all. A heuristic that refuses to start
 * would turn a self-hoster's unusual-but-correct hostname into an outage, and the
 * authoritative check (does a NOTIFY actually arrive?) already runs seconds later
 * and cannot false-green. So this names the likely cause loudly and early; the
 * round trip decides.
 */
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'direct-session' })

/**
 * Hostname markers for a transaction-mode pooler.
 *
 * Deliberately narrow. A broad match ("does the host contain 'pool'") would fire
 * on a perfectly good `db.pool-a.internal`, and a warning that cries wolf is a
 * warning that gets muted.
 */
const POOLER_MARKERS = ['-pooler.', '.pooler.']

/** True when this DSN's host looks like a transaction-mode pooler endpoint. */
export function looksPooled(dsn: string): boolean {
  let host: string
  try {
    host = new URL(dsn).hostname.toLowerCase()
  } catch {
    return false
  }
  return POOLER_MARKERS.some((m) => host.includes(m))
}

/**
 * Warn if a DSN that must be session-mode looks pooled.
 *
 * Returns whether it looked pooled, so a caller that wants to count or surface it
 * can, rather than having to re-derive it from the logs.
 */
export function warnIfPooled(dsn: string, context: { tenantId: string; use: string }): boolean {
  if (!looksPooled(dsn)) return false
  log.error(
    { tenantId: context.tenantId, use: context.use },
    `the DSN for ${context.use} names a POOLED endpoint. LISTEN registers on a ` +
      'transaction-mode pooler and then delivers nothing — measured 0/1 at a single idle ' +
      'client across 16 runs, so this does not degrade under load, it never works. Point ' +
      "this tenant's db_direct_url at the direct endpoint. Continuing anyway: the doorbell " +
      'round trip at boot is the authoritative check, and this one is a hostname heuristic ' +
      'that a self-hosted pooler would not trip.'
  )
  return true
}
