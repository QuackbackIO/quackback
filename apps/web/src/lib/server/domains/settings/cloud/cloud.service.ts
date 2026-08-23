import type { StoredCloudConfig } from '@/lib/shared/db-types'
import { logger } from '@/lib/server/logger'
import { DISABLED_CLOUD_CONFIG, type CloudConfig } from './cloud.types'
import { parseBillingProjection } from './billing-projection'

const log = logger.child({ component: 'cloud-config' })

/** Resolve the latest verified projection using the caller's clock. */
export function resolveCloudConfig(
  stored: StoredCloudConfig | null | undefined,
  now: Date = new Date()
): CloudConfig {
  if (!stored || stored.enabled !== true) return DISABLED_CLOUD_CONFIG
  const projection = parseBillingProjection(stored.projection)
  if (!projection) {
    log.error('cloud config has no valid control-plane projection; keeping commercial mode off')
    return DISABLED_CLOUD_CONFIG
  }

  const accessExpired =
    projection.planLimitsExpireAt !== null &&
    now.getTime() >= Date.parse(projection.planLimitsExpireAt)
  const trialActive =
    projection.subscriptionStatus == null &&
    projection.trialExpiresAt !== null &&
    now.getTime() < Date.parse(projection.trialExpiresAt)

  return {
    enabled: true,
    plan: accessExpired ? 'free' : projection.effectivePlan,
    entitlements: accessExpired ? {} : projection.entitlements,
    subscriptionStatus: projection.subscriptionStatus,
    trialStartedAt: projection.trialStartedAt,
    trialExpiresAt: projection.trialExpiresAt,
    trialActive,
    canUpgrade: projection.canUpgrade,
    canManageBilling: projection.canManageBilling,
    renewalAt: projection.renewalAt,
    cancellationAt: projection.cancellationAt,
  }
}

/**
 * Read commercial state from local workspace settings. A missing or malformed
 * projection resolves to disabled, which is the self-hosted default and never
 * causes an outbound control-plane request.
 */
export async function getCloudConfig(): Promise<CloudConfig> {
  try {
    const { getWorkspaceSettings } = await import('../settings.service')
    const workspace = await getWorkspaceSettings()
    const stored = (workspace?.settings as { cloud?: StoredCloudConfig | null } | undefined)?.cloud
    return resolveCloudConfig(stored ?? null)
  } catch (error) {
    log.error({ err: error }, 'cloud config read failed; falling back to disabled')
    return DISABLED_CLOUD_CONFIG
  }
}
