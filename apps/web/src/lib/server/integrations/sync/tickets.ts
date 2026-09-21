import type { integrations } from '@/lib/server/db'
import type { TicketId } from '@quackback/ids'
import { getIntegration } from '../index'
import { decryptSecrets } from '../encryption'
import { getValidAccessToken } from '../token-refresh'
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
    syncHash(syncDestination({ channelId: config.channelId }, config)) !==
    claim.operation.destinationKey
  )
    return { state: 'cancelled', errorCode: 'installation_changed' }
  const { buildTicketIssueData } =
    await import('@/lib/server/domains/tickets/ticket-external-links.service')
  const data = await buildTicketIssueData(claim.operation.sourceId as TicketId)
  const auth = issues.prepareAuth
    ? await issues.prepareAuth(integration)
    : {
        ...config,
        ...(integration.secrets ? decryptSecrets(integration.secrets) : {}),
        accessToken: await getValidAccessToken(integration.id),
      }
  if (!(await canDispatchSync(claim.operation, integration)) || !(await markSyncDispatched(claim)))
    return { state: 'cancelled' }
  return withSyncTransport(async () => ({
    state: 'succeeded',
    result: { ...(await issues.create!({ auth, ...data })) },
  }))
}
