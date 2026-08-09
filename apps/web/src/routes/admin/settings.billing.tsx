import { createFileRoute, useRouteContext } from '@tanstack/react-router'
import { CreditCardIcon } from '@heroicons/react/24/solid'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { BillingSettings } from '@/components/admin/settings/billing/billing-settings'
import { billingQueries } from '@/lib/client/queries/billing'

/**
 * Plan & billing.
 *
 * Gated on `billing.manage`, the permission the RBAC catalogue has carried
 * for this purpose since custom roles shipped — Owner holds it, Admin does
 * not. On a deployment with no billing provider the loader still runs but
 * the overview resolves to null, so the page renders an empty state rather
 * than an error; the nav does not link here at all in that case.
 */
export const Route = createFileRoute('/admin/settings/billing')({
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.BILLING_MANAGE)
    await context.queryClient.ensureQueryData(billingQueries.overview())
    return {}
  },
  component: BillingPage,
})

function BillingPage() {
  const { billingEnabled } = useRouteContext({ from: '__root__' })

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={CreditCardIcon}
        title="Plan & billing"
        description="Your plan, your seats, and what you are being charged for."
      />
      {billingEnabled ? (
        <BillingSettings />
      ) : (
        <p className="text-sm text-muted-foreground">
          This deployment is not configured for billing.
        </p>
      )}
    </div>
  )
}
