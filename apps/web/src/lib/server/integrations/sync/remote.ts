import { SyncRequestError } from './errors'
import { getIntegration } from '../index'
import { decryptSecrets } from '../encryption'
import { getValidAccessToken } from '../token-refresh'
import { currentSyncIntegration } from './eligibility'
import { readSyncPayload } from './ledger'
import { syncDestination, syncHash } from './identity'
import type { SyncOperation } from './types'

export async function inspectSyncRemote(op: SyncOperation, reference: string) {
  const integration = await currentSyncIntegration(op)
  const inspect = getIntegration(op.provider)?.issues?.inspect
  if (!integration || !inspect)
    throw new SyncRequestError('Remote verification is unavailable for this connection')
  const config = (integration.config ?? {}) as Record<string, unknown>
  const payload = readSyncPayload(op)
  const target = payload.data.target ?? { channelId: config.channelId }
  if (syncHash(syncDestination(target, config)) !== op.destinationKey)
    throw new SyncRequestError('The destination changed. This sync cannot use the new destination.')
  const auth = {
    ...config,
    ...(integration.secrets ? decryptSecrets(integration.secrets) : {}),
    accessToken: await getValidAccessToken(integration.id),
    ...(target as Record<string, unknown>),
  }
  try {
    return await inspect({ auth, reference })
  } catch {
    throw new SyncRequestError(
      'Could not verify that item in the original destination. Check its reference and connection.'
    )
  }
}
