import { db, eq, sql, integrations } from '@/lib/server/db'
import type { JobSqlExecutor } from '@/lib/server/jobs/job-queue'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { fromUuid } from '@quackback/ids'
import { queueSyncOperation } from './ledger'
import { installationIdentity, syncOperationKey } from './identity'

/** Retains the existing app-hook handler and queue, with durable outcome history. */
export async function queueAppHookSync(
  provider: string,
  deliveryId: string,
  payload: Record<string, unknown>,
  executor?: JobSqlExecutor
): Promise<void> {
  if (!executor) return db.transaction((tx) => queueAppHookSync(provider, deliveryId, payload, tx))
  const [row] = getExecuteRows<{ id: string; connected_at: string | null }>(
    await executor.execute(sql`
    SELECT id, connected_at FROM integrations WHERE ${eq(integrations.integrationType, provider)} AND status = 'active'`)
  )
  if (!row) return
  const integrationId = fromUuid('integration', row.id)
  const installation = installationIdentity({ id: integrationId, connectedAt: row.connected_at })
  const destination = { app: provider }
  await queueSyncOperation(
    {
      operationKey: syncOperationKey({
        installation,
        destination,
        kind: 'app-hook',
        sourceType: 'event',
        sourceId: deliveryId,
      }),
      integrationId,
      installation,
      provider,
      direction: 'inbound',
      kind: 'app-hook',
      sourceType: 'event',
      sourceId: deliveryId,
      sourceRevision: typeof payload.occurredAt === 'string' ? payload.occurredAt : undefined,
      destination,
      payload: { executor: 'app-hook', data: payload },
    },
    executor
  )
}
