import type { integrations } from '@/lib/server/db'
import type { TicketId } from '@quackback/ids'
import { getIntegration } from '../index'
import { getIntegrationAuth } from '../token-refresh'
import { syncDestination, syncHash } from './identity'
import { markSyncDispatched } from './ledger'
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
  if (
    syncHash(
      syncDestination(
        { channelId: config.channelId },
        config,
        getIntegration(integration.integrationType)
      )
    ) !== claim.operation.destinationKey
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
  }
  if (!(await canDispatchSync(claim.operation, integration)) || !(await markSyncDispatched(claim)))
    return { state: 'cancelled' }
  return withSyncTransport(async () => ({
    state: 'succeeded',
    result: { ...(await issues.create!({ auth, ...data })) },
  }))
}
