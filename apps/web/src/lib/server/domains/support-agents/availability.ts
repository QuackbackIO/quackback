import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import { requireEntitlement } from '@/lib/server/domains/settings/cloud/entitlements'
import { ForbiddenError } from '@/lib/shared/errors'

/** The experimental switch is off by default. Self-hosted installs stay unrestricted. */
export async function assertOwnAgentAvailable(): Promise<void> {
  if (!(await isFeatureEnabled('ownAgent')))
    throw new ForbiddenError('OWN_AGENT_DISABLED', 'Your AI agent is not enabled')
  await requireEntitlement('ownAgent')
}
