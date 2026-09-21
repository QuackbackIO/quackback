import { db, eq, sql, integrations } from '@/lib/server/db'
import { installationIdentity } from './identity'

/** Health is a projection of unresolved operations, never the last racing callback. */
export async function updateSyncHealth(integrationId: string): Promise<void> {
  // Lock first, then take a fresh READ COMMITTED snapshot. Concurrent completions
  // cannot clear an error using a snapshot taken before the lock was acquired.
  await db.transaction(async (tx) => {
    const [integration] = await tx
      .select()
      .from(integrations)
      .where(eq(integrations.id, integrationId as never))
      .for('update')
    if (!integration) return
    const installation = installationIdentity(integration)
    await tx.execute(sql`
    UPDATE integrations SET
      last_outbound_at = health.outbound_at,
      last_inbound_at = health.inbound_at,
      error_count = health.errors,
      last_error = CASE WHEN health.errors > 0 THEN 'Some syncs need attention. Open Sync history.' ELSE NULL END,
      last_error_at = health.error_at
    FROM (
      SELECT
        max(finished_at) FILTER (WHERE direction = 'outbound' AND state = 'succeeded') AS outbound_at,
        max(finished_at) FILTER (WHERE direction = 'inbound' AND state = 'succeeded') AS inbound_at,
        count(*) FILTER (WHERE state IN ('failed', 'auth_required', 'uncertain', 'conflict'))::integer AS errors,
        max(updated_at) FILTER (WHERE state IN ('failed', 'auth_required', 'uncertain', 'conflict')) AS error_at
      FROM integration_sync_operations
      WHERE integration_id = ${integrationId} AND installation = ${installation}
    ) health
    WHERE ${eq(integrations.id, integrationId as never)}
  `)
  })
}
