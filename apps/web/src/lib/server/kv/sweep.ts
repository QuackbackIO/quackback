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
 * Runs inside a workspace scope, so on a pooled fleet it is driven per workspace by
 * the same fan-out as the other sweeps (`sweep-lock.ts`).
 */
import { sql } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { currentWorkspaceNamespace } from '@/lib/server/workspaces/workspace-keyed'
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

function deleted(result: unknown): number {
  return getExecuteRows<{ id: unknown }>(result).length
}

/**
 * Delete every expired row for the active workspace.
 *
 * Scoped by `workspace_key` rather than sweeping the table: on a pooled fleet this
 * runs inside one workspace's scope against one workspace's database, and a sweep
 * that ignored the discriminator would be the one statement in the system
 * allowed to cross it.
 */
export async function sweepExpiredKv(): Promise<KvSweepResult> {
  const t = currentWorkspaceNamespace()
  const result: KvSweepResult = {
    kvStore: deleted(
      await db.execute(
        sql`DELETE FROM kv_store WHERE workspace_key = ${t} AND expires_at <= now() RETURNING key AS id`
      )
    ),
    rateBucket: deleted(
      await db.execute(
        sql`DELETE FROM rate_bucket WHERE workspace_key = ${t} AND window_expires_at <= now() RETURNING key AS id`
      )
    ),
    setMembers: deleted(
      await db.execute(
        sql`DELETE FROM kv_set_member WHERE workspace_key = ${t} AND expires_at <= now() RETURNING member AS id`
      )
    ),
    presence: deleted(
      await db.execute(sql`
        DELETE FROM presence_stream
        WHERE workspace_key = ${t}
          AND heartbeat_at <= now() - make_interval(secs => ${PRESENCE_TTL_SECONDS})
        RETURNING stream_id AS id
      `)
    ),
    overflow: deleted(
      await db.execute(
        sql`DELETE FROM realtime_overflow WHERE workspace_key = ${t} AND expires_at <= now() RETURNING id`
      )
    ),
  }
  const total =
    result.kvStore + result.rateBucket + result.setMembers + result.presence + result.overflow
  if (total > 0) log.info({ ...result }, 'expired store rows reclaimed')
  return result
}
