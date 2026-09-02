import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { describeEntitlementUpgrade, type UpgradeDescription } from '@/lib/shared/describe-upgrade'
import type { EntitlementKey } from '@/lib/server/domains/settings'
import { UpgradeOffer } from './upgrade-offer'

/** Action lock (export, create webhook, create workflow). Stays on the current route. */
export function UpgradeModal(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  entitlement?: EntitlementKey
  description?: UpgradeDescription
}) {
  const description = props.description ?? describeEntitlementUpgrade(props.entitlement!)
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-lg sm:max-w-lg">
        <DialogHeader className="sr-only">
          <DialogTitle>{description.headline}</DialogTitle>
          <DialogDescription>{description.body}</DialogDescription>
        </DialogHeader>
        <UpgradeOffer
          description={description}
          onDismiss={() => props.onOpenChange(false)}
          dismissLabel="Maybe later"
          className="[&>div:first-child]:pr-6"
        />
      </DialogContent>
    </Dialog>
  )
}
