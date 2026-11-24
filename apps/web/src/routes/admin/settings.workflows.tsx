import { lazy, Suspense } from 'react'
import { createFileRoute, Navigate } from '@tanstack/react-router'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import { settingsQueries } from '@/lib/client/queries/settings'
import { workflowsQuery } from '@/lib/client/queries/workflows'
import { WhoRepliesFirstCard } from '@/components/admin/automation/who-replies-first-card'
import { AbandonedJourneyAutoCloseCard } from '@/components/admin/automation/abandoned-journey-auto-close-card'
import { ConversationRoutingCard } from '@/components/admin/automation/conversation-routing-card'
import { WorkflowsManager } from '@/components/admin/automation/workflows-manager'
import { warmQuery } from '@/lib/client/queries/warm-query'
import { useCloudEnabled, useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertSettingsPageAccess } from '@/lib/shared/settings-page-access'
import { adminPageHead } from '@/lib/client/admin-head'
import type { PlanNoticeFeature } from '@/components/admin/settings/plan-feature-notice-body'

export const Route = createFileRoute('/admin/settings/workflows')({
  head: adminPageHead('Workflows settings'),
  beforeLoad: ({ context }) =>
    assertSettingsPageAccess(context.permissions, '/admin/settings/workflows'),
  loader: async ({ context }) => {
    const { hasEntitlementFn } = await import('@/lib/server/functions/entitlement-status')
    const { ensureBillingCatalogue } = await import('@/lib/client/queries/billing')
    const { queryClient } = context
    const flags = context.settings?.featureFlags as FeatureFlags | undefined
    // The workflow list, the close-spam toggle and (for routing.manage
    // holders) the auto-assign switch, read on every load; skipped when the
    // page redirects away instead. The list's run counts stay with the page:
    // they render through the browser's number format, which the server
    // cannot match.
    const pageReads = flags?.supportInbox
      ? [
          warmQuery(queryClient, workflowsQuery()),
          warmQuery(queryClient, settingsQueries.workflowCloseSpam()),
          context.permissions?.includes(PERMISSIONS.ROUTING_MANAGE)
            ? warmQuery(queryClient, settingsQueries.conversationRouting())
            : undefined,
        ]
      : []
    const [, workflowsEntitled] = await Promise.all([
      // Nothing here may need settings.manage: Support leads open this page
      // without it, and one refused read fails the whole page.
      Promise.all([
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
  const settings = useWorkspaceSettings()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  if (!flags?.supportInbox) {
    return <Navigate to="/admin/settings/agent" />
  }
  return <WorkflowsPage />
}

function WorkflowsPage() {
  const { workflowsEntitled } = Route.useLoaderData()
  return (
    <WorkflowsManager
      entitled={workflowsEntitled}
      after={
        <>
          <ConversationRoutingCard />
          <AbandonedJourneyAutoCloseCard />
        </>
      }
    >
      <PlanFeatureNotice feature="workflows" />
      <WhoRepliesFirstCard />
    </WorkflowsManager>
  )
}

/**
 * The paused notice. The plan billing check lives in this route rather than a
 * shared module, so without plan billing the page loads no extra chunk.
 */
const PlanFeatureNoticeBody = lazy(
  () => import('@/components/admin/settings/plan-feature-notice-body')
)

function PlanFeatureNotice({ feature }: { feature: PlanNoticeFeature }) {
  if (!useCloudEnabled()) return null
  return (
    <Suspense fallback={null}>
      <PlanFeatureNoticeBody feature={feature} />
    </Suspense>
  )
}
