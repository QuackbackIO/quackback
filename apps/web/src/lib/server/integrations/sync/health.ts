import { db, sql } from '@/lib/server/db'
import { installationIdentity } from './identity'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'

/** Read the current installation's sync health without mutating connection errors. */
export async function readSyncHealth(integration: {
  id: string
  connectedAt: Date | string | null
}) {
  const installation = installationIdentity(integration)
  const [health] = getExecuteRows<{
    outbound_at: Date | string | null
    inbound_at: Date | string | null
    attention_count: number
  }>(
    await db.execute(sql`
    SELECT
      (SELECT max(finished_at) FROM integration_sync_operations
        WHERE integration_id = ${integration.id} AND installation = ${installation}
          AND direction = 'outbound' AND state = 'succeeded') AS outbound_at,
      (SELECT max(finished_at) FROM integration_sync_operations
        WHERE integration_id = ${integration.id} AND installation = ${installation}
          AND direction = 'inbound' AND state = 'succeeded') AS inbound_at,
      count(*)::integer AS attention_count
    FROM integration_sync_operations
    WHERE integration_id = ${integration.id} AND installation = ${installation}
      AND state IN ('failed', 'auth_required', 'uncertain', 'conflict')
  `)
  )
  const iso = (value: Date | string | null | undefined) =>
    value ? new Date(value).toISOString() : null
  return {
    lastOutboundAt: iso(health?.outbound_at),
    lastInboundAt: iso(health?.inbound_at),
    attentionCount: health?.attention_count ?? 0,
  }
}
