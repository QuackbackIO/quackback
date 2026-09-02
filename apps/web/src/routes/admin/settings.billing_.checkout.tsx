import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useRouteContext } from '@tanstack/react-router'
import { CreditCardIcon } from '@heroicons/react/24/solid'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { CheckoutBuilder } from '@/components/admin/settings/billing/checkout-builder'
import { billingQueries } from '@/lib/client/queries/billing'
import { parseCheckoutSearch, type CheckoutSearch } from '@/lib/shared/billing/checkout-path'
import type { BillingCatalogue } from '@/lib/server/control-plane/client'

// The trailing underscore on "billing_" keeps this a sibling of Plans &
// billing rather than a child rendered inside it. The URL is still
// /admin/settings/billing/checkout.
export const Route = createFileRoute('/admin/settings/billing_/checkout')({
  validateSearch: (search: Record<string, unknown>): CheckoutSearch => parseCheckoutSearch(search),
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.BILLING_MANAGE)
    await Promise.all([
      context.queryClient.ensureQueryData(billingQueries.overview()),
      context.queryClient.ensureQueryData(billingQueries.catalogue()).catch(() => null),
    ])
    return {}
  },
  component: CheckoutPage,
})

function CheckoutPage() {
  const { billingEnabled } = useRouteContext({ from: '__root__' })
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data: overview } = useSuspenseQuery(billingQueries.overview())
  const catalogue = useQuery(billingQueries.catalogue())
  const catalogueData = (catalogue.data ?? null) as BillingCatalogue | null

  const selection = {
    plan: search.plan ?? null,
    period: search.period ?? 'annual',
    seats: search.seats ?? Math.max(overview?.seats?.used ?? 1, 1),
    branding: search.branding ?? false,
  }

  return (
    <div className="max-w-5xl space-y-6">
      <BackLink
        to="/admin/settings/billing"
        search={{ checkout: undefined, billing_error: undefined }}
      >
        Plans &amp; billing
      </BackLink>
      <PageHeader
        icon={CreditCardIcon}
        title="Configure your plan"
        description="Choose a plan, billing cycle, and seats. Payment happens on the next step."
      />
      {!billingEnabled || !overview ? (
        <p className="text-sm text-muted-foreground">
          Plan and billing is available only in a Quackback Cloud workspace.
        </p>
      ) : catalogue.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading plans…</p>
      ) : !catalogueData ? (
        <p role="alert" className="text-[13px] text-destructive">
          Couldn’t load plans. Try again in a moment.
        </p>
      ) : (
        <CheckoutBuilder
          overview={overview}
          catalogue={catalogueData}
          selection={selection}
          onChange={(next) =>
            navigate({
              search: (previous) => {
                const merged = { ...previous, ...next }
                if (!merged.branding) delete merged.branding
                return merged
              },
              replace: true,
            })
          }
        />
      )}
    </div>
  )
}
