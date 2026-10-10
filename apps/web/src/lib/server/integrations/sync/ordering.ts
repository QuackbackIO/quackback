import { and, eq, sql, integrationSyncOperations as operations } from '@/lib/server/db'
import type { SyncOperation } from './types'
import type { SyncTransaction } from './ledger'

/** Called under a source lock, inside the same transaction as the local mutation. */
export async function hasNewerInbound(tx: SyncTransaction, op: SyncOperation): Promise<boolean> {
  if (!op.sourceRevision) return false
  const [newer] = await tx
    .select({ id: operations.id })
    .from(operations)
    .where(
      and(
        eq(operations.installation, op.installation),
        eq(operations.direction, 'inbound'),
        eq(operations.sourceType, op.sourceType),
        eq(operations.sourceId, op.sourceId),
        eq(operations.kind, op.kind),
        eq(operations.state, 'succeeded'),
        sql`${operations.sourceRevision} > ${op.sourceRevision}`
      )
    )
    .limit(1)
  return !!newer
}
