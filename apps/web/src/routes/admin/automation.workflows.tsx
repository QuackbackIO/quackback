import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import { BackLink } from '@/components/ui/back-link'
import { settingsQueries } from '@/lib/client/queries/settings'
import { workflowsQuery } from '@/lib/client/queries/workflows'
import { WhoRepliesFirstCard } from '@/components/admin/automation/who-replies-first-card'
import { AbandonedJourneyAutoCloseCard } from '@/components/admin/automation/abandoned-journey-auto-close-card'
import { WorkflowsManager } from '@/components/admin/automation/workflows-manager'
import { warmQuery } from '@/lib/client/queries/warm-query'

export const Route = createFileRoute('/admin/automation/workflows')({
  loader: async ({ context }) => {
    const { hasEntitlementFn } = await import('@/lib/server/functions/entitlement-status')
    const { ensureBillingCatalogue } = await import('@/lib/client/queries/billing')
    const { queryClient } = context
    const flags = context.settings?.featureFlags as FeatureFlags | undefined
    // The workflow list and the close-spam toggle, read on every load;
    // skipped when the page redirects away instead. The list's run counts
    // stay with the page: they render through the browser's number format,
    // which the server cannot match.
    const pageReads = flags?.supportInbox
      ? [
          warmQuery(queryClient, workflowsQuery()),
          warmQuery(queryClient, settingsQueries.workflowCloseSpam()),
        ]
      : []
    const [, workflowsEntitled] = await Promise.all([
      Promise.all([
        queryClient.ensureQueryData(settingsQueries.widgetConfig()),
        queryClient.ensureQueryData(settingsQueries.workflowAbandonedAutoClose()),
        ...pageReads,
      ]),
      hasEntitlementFn({ data: { key: 'workflows' } }),
      ensureBillingCatalogue(queryClient, context.billingEnabled),
    ])
    return { workflowsEntitled }
  },
  component: WorkflowsPageRoute,
})

/** Gate behind the `supportInbox` flag, mirroring the messenger settings page. */
function WorkflowsPageRoute() {
  const settings = Route.useRouteContext({ select: (context) => context.settings })
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
