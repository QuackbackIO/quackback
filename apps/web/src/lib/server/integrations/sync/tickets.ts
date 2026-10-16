import type { integrations } from '@/lib/server/db'
import type { TicketId } from '@quackback/ids'
import { getIntegration } from '../index'
import { getIntegrationAuth } from '../token-refresh'
import { syncDestination, syncHash } from './identity'
import { markSyncDispatched, readSyncPayload } from './ledger'
import { outboundAllowed } from '../destinations'
import { withSyncTransport } from './transport'
import type { SyncClaim, SyncOutcome } from './types'
import { canDispatchSync } from './eligibility'

export async function executeTicketCreate(
  claim: SyncClaim,
  integration: typeof integrations.$inferSelect
): Promise<SyncOutcome> {
  const issues = getIntegration(integration.integrationType)?.issues
  if (!issues?.create) return { state: 'cancelled', errorCode: 'installation_changed' }
  const config = (integration.config ?? {}) as Record<string, unknown>
  // The repository chosen at request time; requests queued before targets
  // were recorded went to the connection's own repository.
  const target = (readSyncPayload(claim.operation).data.target as
    { channelId: unknown } | undefined) ?? { channelId: config.channelId }
  if (
    syncHash(syncDestination(target, config, getIntegration(integration.integrationType))) !==
      claim.operation.destinationKey ||
    !(await outboundAllowed(integration, target.channelId))
  )
    return { state: 'cancelled', errorCode: 'installation_changed' }
  const { buildTicketIssueData } =
    await import('@/lib/server/domains/tickets/ticket-external-links.service')
  const data = await buildTicketIssueData(claim.operation.sourceId as TicketId)
  const credentials = await getIntegrationAuth(integration.id)
  const auth = {
    ...credentials.config,
    ...credentials.secrets,
    accessToken: credentials.accessToken,
    channelId: target.channelId,
  }
  if (!(await canDispatchSync(claim.operation, integration)) || !(await markSyncDispatched(claim)))
    return { state: 'cancelled' }
  return withSyncTransport(async () => ({
    state: 'succeeded',
    result: { ...(await issues.create!({ auth, ...data })) },
  }))
}
