import { createFileRoute, Navigate } from '@tanstack/react-router'
import { isProductEnabled, type FeatureFlags } from '@/lib/shared/types/settings'
import { settingsQueries } from '@/lib/client/queries/settings'
import { workflowsQuery } from '@/lib/client/queries/workflows'
import { AbandonedJourneyAutoCloseCard } from '@/components/admin/automation/abandoned-journey-auto-close-card'
import { WorkflowsManager } from '@/components/admin/automation/workflows-manager'
import { warmQuery } from '@/lib/client/queries/warm-query'
import { useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { adminPageHead } from '@/lib/client/admin-head'

export const Route = createFileRoute('/admin/settings/workflows')({
  head: adminPageHead('Workflows settings'),
  beforeLoad: ({ context }) =>
    assertRoutePermission(context.permissions, PERMISSIONS.WORKFLOW_MANAGE),
  loader: async ({ context }) => {
    const { hasEntitlementFn } = await import('@/lib/server/functions/entitlement-status')
    const { ensureBillingCatalogue } = await import('@/lib/client/queries/billing')
    const { queryClient } = context
    const flags = context.settings?.featureFlags as FeatureFlags | undefined
    // The workflow list and the close-spam toggle, read on every load;
    // skipped when the page redirects away instead. The list's run counts
    // stay with the page: they render through the browser's number format,
    // which the server cannot match.
    const pageReads = isProductEnabled(flags, 'support')
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

/** Workflows run on conversations and on tickets, so either Support switch shows the page. */
function WorkflowsPageRoute() {
  const settings = useWorkspaceSettings()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  if (!isProductEnabled(flags, 'support')) {
    return <Navigate to="/admin/settings/general" />
  }
  return <WorkflowsPage inboxOn={Boolean(flags?.supportInbox)} />
}

function WorkflowsPage({ inboxOn }: { inboxOn: boolean }) {
  const { workflowsEntitled } = Route.useLoaderData()
  return (
    <WorkflowsManager
      entitled={workflowsEntitled}
      after={inboxOn ? <AbandonedJourneyAutoCloseCard /> : undefined}
    />
  )
}
