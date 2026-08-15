import { describeEntitlementUpgrade, type UpgradeDescription } from '@/lib/shared/describe-upgrade'
import type { EntitlementKey } from '@/lib/server/domains/settings'
import { UpgradeOffer } from './upgrade-offer'

/** In-route lock. The URL stays; no redirect to Plan & billing. */
export function UpgradeScreen(props: {
  entitlement?: EntitlementKey
  description?: UpgradeDescription
  onDismiss?: () => void
  dismissLabel?: string
}) {
  const description = props.description ?? describeEntitlementUpgrade(props.entitlement!)
  return (
    <div className="rounded-xl border border-border/60 bg-card/30 px-6 py-10">
      <UpgradeOffer
        description={description}
        onDismiss={props.onDismiss}
        dismissLabel={props.dismissLabel}
      />
    </div>
  )
}
