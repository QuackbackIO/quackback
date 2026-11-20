import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { assertSettingsPageAccess } from '@/lib/shared/settings-page-access'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { PlanLimitsView } from '@/components/admin/settings/billing/plan-limits-view'
import { Badge } from '@/components/ui/badge'
import { planLimitsQueries } from '@/lib/client/queries/plan-limits'
import { billingQueries } from '@/lib/client/queries/billing'
import { usePermissions } from '@/lib/client/hooks/use-root-context'
import { adminPageHead } from '@/lib/client/admin-head'

// The trailing underscore on "billing_" keeps this a sibling of Plan &
// billing, like checkout. The URL is /admin/settings/billing/limits.
//
// Every teammate can read it, not only billing managers: the banner sends
// everyone here, and each fix is offered to whoever may make it.
export const Route = createFileRoute('/admin/settings/billing_/limits')({
  head: adminPageHead('Plan limits'),
  loader: async ({ context }) => {
    assertSettingsPageAccess(context.permissions, '/admin/settings/billing/limits')
    // Loaded on demand so the queries and their server functions stay out of
    // the entry chunk every admin page downloads.
    const { planLimitsQueries: queries } = await import('@/lib/client/queries/plan-limits')
    await context.queryClient.ensureQueryData(queries.page())
    return {}
  },
  component: PlanLimitsPage,
})

function PlanLimitsPage() {
  const { data: limits } = useSuspenseQuery(planLimitsQueries.page())
  const catalogue = useQuery({ ...billingQueries.catalogue(), retry: false })
  const permissions = usePermissions()
  return (
    <SettingsPage
      title="Plan limits"
      width="wide"
      badge={
        limits.planName ? (
          <Badge size="sm" variant="secondary">
            {limits.planName} plan
          </Badge>
        ) : null
      }
      crumbs={
        limits.canManageBilling
          ? [
              {
                label: 'Plan & billing',
                to: '/admin/settings/billing',
                search: { checkout: undefined, billing_error: undefined },
              },
            ]
          : undefined
      }
    >
      <PlanLimitsView
        limits={limits}
        permissions={permissions}
        catalogue={catalogue.data ?? null}
      />
    </SettingsPage>
  )
}
