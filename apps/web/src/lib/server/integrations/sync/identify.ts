import { eq, sql, user } from '@/lib/server/db'
import type { UserId } from '@quackback/ids'
import { mergeUserAttributes } from '../user-sync-handler'
import type { SyncClaim } from './types'
import type { SyncTransaction } from './ledger'
import { hasNewerInbound } from './ordering'
import type { SyncOutcome } from './types'

export async function applyIdentifySync(
  tx: SyncTransaction,
  claim: SyncClaim,
  data: Record<string, unknown>
): Promise<void | SyncOutcome> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`user:${claim.operation.sourceId}`}, 0))`
  )
  if (!claim.operation.sourceRevision) return { state: 'conflict', errorCode: 'missing_baseline' }
  if (await hasNewerInbound(tx, claim.operation)) return { state: 'superseded' }
  const record = await tx.query.user.findFirst({
    where: eq(user.id, claim.operation.sourceId as UserId),
  })
  if (!record?.email || record.email !== data.email) throw new Error('Identify source changed')
  await mergeUserAttributes(
    record.email,
    data.attributes as Record<string, unknown>,
    typeof data.externalUserId === 'string' ? { _externalUserId: data.externalUserId } : {},
    tx
  )
}
