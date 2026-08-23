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
 * not. A valid control-plane projection is also required; self-hosted
 * workspaces therefore have no navigation item or commercial dependency.
 */
export const Route = createFileRoute('/admin/settings/billing')({
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.BILLING_MANAGE)
    await Promise.all([
      context.queryClient.ensureQueryData(billingQueries.overview()),
      context.queryClient.ensureQueryData(billingQueries.catalogue()).catch(() => null),
      context.queryClient.ensureQueryData(billingQueries.invoices()).catch(() => null),
    ])
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
        title="Plans & billing"
        description="Manage your plan and billing history here."
      />
      {billingEnabled ? (
        <BillingSettings />
      ) : (
        <p className="text-sm text-muted-foreground">
          Plan and billing is available only in a Quackback Cloud workspace.
        </p>
      )}
    </div>
  )
}
