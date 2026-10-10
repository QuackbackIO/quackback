import { db, eq, and, user, segments, userSegments, type integrations } from '@/lib/server/db'
import type { PrincipalId, UserId, SegmentId } from '@quackback/ids'
import { realEmail } from '@/lib/shared/anonymous-email'
import { getIntegration } from '../index'
import { decryptSecrets } from '../encryption'
import { markSyncDispatched } from './ledger'
import { withSyncTransport } from './transport'
import { syncDestination, syncHash } from './identity'
import type { SyncClaim, SyncOutcome } from './types'
import { canDispatchSync } from './eligibility'

export async function executeSegmentSync(
  claim: SyncClaim,
  data: Record<string, unknown>,
  integration: typeof integrations.$inferSelect
): Promise<SyncOutcome> {
  const config = (integration.config ?? {}) as Record<string, unknown>
  const sync = getIntegration(integration.integrationType)?.userSync?.syncSegmentMembership
  if (
    !config.outgoingEnabled ||
    !sync ||
    syncHash(
      syncDestination(
        { segmentId: data.segmentId },
        config,
        getIntegration(integration.integrationType)
      )
    ) !== claim.operation.destinationKey
  )
    return { state: 'cancelled', errorCode: 'installation_changed' }
  const [person, segment, member] = await Promise.all([
    db.query.user.findFirst({ where: eq(user.id, claim.operation.sourceId as UserId) }),
    db.query.segments.findFirst({ where: eq(segments.id, data.segmentId as SegmentId) }),
    db.query.userSegments.findFirst({
      where: and(
        eq(userSegments.segmentId, data.segmentId as SegmentId),
        eq(userSegments.principalId, data.principalId as PrincipalId)
      ),
    }),
  ])
  const email = realEmail(person?.email)
  if (
    !email ||
    !segment ||
    segment.deletedAt ||
    segment.name !== data.segmentName ||
    !!member !== data.joined
  )
    return { state: 'superseded' }
  let externalUserId: string | undefined
  try {
    const meta = JSON.parse(person?.metadata ?? '{}')
    if (typeof meta._externalUserId === 'string') externalUserId = meta._externalUserId
  } catch {
    /* Optional mapping. */
  }
  const secrets = integration.secrets ? decryptSecrets(integration.secrets) : {}
  if (!(await canDispatchSync(claim.operation, integration)) || !(await markSyncDispatched(claim)))
    return { state: 'cancelled' }
  return withSyncTransport(async () => {
    await sync(
      [{ email, externalUserId }],
      segment.name,
      Boolean(data.joined),
      { ...config, syncOperationKey: claim.operation.operationKey },
      secrets
    )
    return { state: 'succeeded' }
  })
}
