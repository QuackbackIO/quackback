import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { describeEntitlementUpgrade } from '@/lib/shared/describe-upgrade'
import { UpgradeNotice } from '@/components/admin/upgrade'
import { useBillingEnabled } from '@/lib/client/hooks/use-root-context'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { PERMISSIONS } from '@/lib/shared/permissions'

/** @deprecated Use describeEntitlementUpgrade('sso') */
export function ssoUpgradePlanName(): string {
  return describeEntitlementUpgrade('sso').requiredPlanName ?? 'Enterprise'
}

export function SsoUpgradeNotice() {
  return <UpgradeNotice entitlement="sso" />
}

/**
 * A provider is set up but the plan does not include single sign-on, so email
 * links stand in for it (see `effectiveSignInMethods`). Same frame as the
 * upgrade notice; the way to Plan & billing is offered only to someone who can
 * change the plan, where billing is managed in the app.
 */
export function SsoOffOnPlanNotice() {
  const billingEnabled = useBillingEnabled()
  const canManageBilling = usePermission(PERMISSIONS.BILLING_MANAGE)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border/50 bg-muted/10 p-5">
      <p className="min-w-0 text-sm text-muted-foreground">
        Single sign-on is set up but off on your current plan. Your team signs in with email links.
      </p>
      {billingEnabled && canManageBilling ? (
        <Button asChild size="sm" variant="outline">
          <Link
            to="/admin/settings/billing"
            search={{ checkout: undefined, billing_error: undefined }}
          >
            View plans
          </Link>
        </Button>
      ) : null}
    </div>
  )
}
