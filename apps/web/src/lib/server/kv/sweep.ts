/**
 * Space reclamation for the tables that replaced Redis.
 *
 * **This is not what makes expiry correct.** Every read in `pg-kv.ts`,
 * `realtime/presence.ts` and `realtime/pubsub.ts` filters on `expires_at >
 * now()` (or a heartbeat cutoff), so an expired row is invisible the instant it
 * expires whether or not this has ever run. Redis deleted a key when its TTL
 * elapsed and callers depended on that deletion; here the predicate is the
 * guarantee and this is only the vacuum behind it.
 *
 * That distinction matters because it decides what a missed sweep costs: disk,
 * not correctness. A sweeper that were load-bearing would make every one of
 * these stores wrong for as long as a worker tier was down.
 *
 * Runs inside a tenant scope, so on a pooled fleet it is driven per tenant by
 * the same fan-out as the other sweeps (`sweep-lock.ts`).
 */
import { sql } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { getExecuteCount } from '@/lib/server/utils/execute-rows'
import { currentTenantNamespace } from '@/lib/server/tenancy/tenant-keyed'
import { PRESENCE_TTL_SECONDS } from '@/lib/server/realtime/presence'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'kv-sweep' })

export interface KvSweepResult {
  kvStore: number
  rateBucket: number
  setMembers: number
  presence: number
  overflow: number
}

// No RETURNING on these deletes: only the count matters, and the driver
// reports it without shipping every reclaimed row over the wire.
function deleted(result: unknown): number {
  return getExecuteCount(result)
}

/**
 * Delete every expired row for the active tenant.
 *
 * Scoped by `tenant_id` rather than sweeping the table: on a pooled fleet this
 * runs inside one tenant's scope against one tenant's database, and a sweep
 * that ignored the discriminator would be the one statement in the system
 * allowed to cross it.
 */
export async function sweepExpiredKv(): Promise<KvSweepResult> {
  const t = currentTenantNamespace()
  const result: KvSweepResult = {
    kvStore: deleted(
      await db.execute(sql`DELETE FROM kv_store WHERE tenant_id = ${t} AND expires_at <= now()`)
    ),
    rateBucket: deleted(
      await db.execute(
        sql`DELETE FROM rate_bucket WHERE tenant_id = ${t} AND window_expires_at <= now()`
      )
    ),
    setMembers: deleted(
      await db.execute(
        sql`DELETE FROM kv_set_member WHERE tenant_id = ${t} AND expires_at <= now()`
      )
    ),
    presence: deleted(
      await db.execute(sql`
        DELETE FROM presence_stream
        WHERE tenant_id = ${t}
          AND heartbeat_at <= now() - make_interval(secs => ${PRESENCE_TTL_SECONDS})
      `)
    ),
    overflow: deleted(
      await db.execute(
        sql`DELETE FROM realtime_overflow WHERE tenant_id = ${t} AND expires_at <= now()`
      )
    ),
  }
  const total =
    result.kvStore + result.rateBucket + result.setMembers + result.presence + result.overflow
  if (total > 0) log.info({ ...result }, 'expired store rows reclaimed')
  return result
}
