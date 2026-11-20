import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { describeEntitlementUpgrade } from '@/lib/shared/describe-upgrade'
import { UpgradeNotice } from '@/components/admin/upgrade'
import { billingQueries } from '@/lib/client/queries/billing'
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
 * upgrade notice. The plan is named from the upgrade context the settings
 * layout already loads; when no plan is known the sentence leaves it unnamed.
 * Where billing is managed in the app, someone who can change the plan gets
 * Upgrade and everyone else is told who can.
 */
export function SsoOffOnPlanNotice() {
  const billingEnabled = useBillingEnabled()
  const canManageBilling = usePermission(PERMISSIONS.BILLING_MANAGE)
  const { data: context } = useQuery({
    ...billingQueries.upgradeContext(),
    enabled: billingEnabled,
  })
  const planName = billingEnabled ? (context?.currentPlanName ?? null) : null
  const paused = planName
    ? `Single sign-on is paused on the ${planName} plan.`
    : 'Single sign-on is paused.'
  const comesBack = billingEnabled ? ' It comes back when you upgrade.' : ''
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border/50 bg-muted/10 p-5">
      <div className="min-w-0 space-y-1 text-sm text-muted-foreground">
        <p>{`${paused} Your team signs in with email links.${comesBack}`}</p>
        {billingEnabled && !canManageBilling ? (
          <p>Ask someone who manages billing to upgrade.</p>
        ) : null}
      </div>
      {billingEnabled && canManageBilling ? (
        <Button asChild size="sm" variant="outline">
          <Link
            to="/admin/settings/billing"
            search={{ checkout: undefined, billing_error: undefined }}
          >
            Upgrade
          </Link>
        </Button>
      ) : null}
    </div>
  )
}
