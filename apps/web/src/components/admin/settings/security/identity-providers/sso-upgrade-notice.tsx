import { describeEntitlementUpgrade } from '@/lib/shared/describe-upgrade'
import { UpgradeNotice } from '@/components/admin/upgrade'

/** @deprecated Use describeEntitlementUpgrade('sso') */
export function ssoUpgradePlanName(): string {
  return describeEntitlementUpgrade('sso').requiredPlanName ?? 'Enterprise'
}

export function SsoUpgradeNotice() {
  return <UpgradeNotice entitlement="sso" />
}
