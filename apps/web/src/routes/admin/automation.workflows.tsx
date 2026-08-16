import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import { BackLink } from '@/components/ui/back-link'
import { settingsQueries } from '@/lib/client/queries/settings'
import { WhoRepliesFirstCard } from '@/components/admin/automation/who-replies-first-card'
import { AbandonedJourneyAutoCloseCard } from '@/components/admin/automation/abandoned-journey-auto-close-card'
import { WorkflowsManager } from '@/components/admin/automation/workflows-manager'

export const Route = createFileRoute('/admin/automation/workflows')({
  loader: async ({ context }) => {
    const { hasEntitlementFn } = await import('@/lib/server/functions/entitlement-status')
    const { ensureBillingCatalogue } = await import('@/lib/client/queries/billing')
    const [, workflowsEntitled] = await Promise.all([
      Promise.all([
        context.queryClient.ensureQueryData(settingsQueries.widgetConfig()),
        context.queryClient.ensureQueryData(settingsQueries.workflowAbandonedAutoClose()),
      ]),
      hasEntitlementFn({ data: { key: 'workflows' } }),
      ensureBillingCatalogue(context.queryClient, context.billingEnabled),
    ])
    return { workflowsEntitled }
  },
  component: WorkflowsPageRoute,
})

/** Gate behind the `supportInbox` flag, mirroring the messenger settings page. */
function WorkflowsPageRoute() {
  const { settings } = Route.useRouteContext()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  if (!flags?.supportInbox) {
    return <Navigate to="/admin/automation/agent" />
  }
  return <WorkflowsPage />
}

function WorkflowsPage() {
  const intl = useIntl()
  const { workflowsEntitled } = Route.useLoaderData()
  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/automation">
          {intl.formatMessage({ id: 'automation.nav.label', defaultMessage: 'AI & Automation' })}
        </BackLink>
      </div>
      <WorkflowsManager entitled={workflowsEntitled}>
        <WhoRepliesFirstCard />
      </WorkflowsManager>
      <AbandonedJourneyAutoCloseCard />
    </div>
  )
}
