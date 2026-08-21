import { describeEntitlementUpgrade, type UpgradeDescription } from '@/lib/shared/describe-upgrade'
import type { EntitlementKey } from '@/lib/server/domains/settings'
import { UpgradeOffer } from './upgrade-offer'

/** In-card lock on a mixed page (SSO card, Domains card). */
export function UpgradeNotice(props: {
  entitlement?: EntitlementKey
  description?: UpgradeDescription
}) {
  const description = props.description ?? describeEntitlementUpgrade(props.entitlement!)
  return (
    <div className="rounded-lg border border-dashed border-border/50 bg-muted/10 p-6">
      <UpgradeOffer description={description} />
    </div>
  )
}
