import { Suspense, lazy } from 'react'
import { createFileRoute, Navigate } from '@tanstack/react-router'
import { Skeleton } from '@/components/ui/skeleton'
import { workflowDetailQuery } from '@/lib/client/queries/workflows'
import { settingsQueries } from '@/lib/client/queries/settings'
import type { FeatureFlags } from '@/lib/shared/types/settings'

const WorkflowBuilder = lazy(() =>
  import('@/components/admin/automation/workflow-builder/workflow-builder').then((m) => ({
    default: m.WorkflowBuilder,
  }))
)

// The trailing underscore on "automation_" escapes nesting under
// /admin/automation's sidebar layout (routes/admin/automation.tsx): this
// route renders fullscreen in the admin shell instead, like the help center
// article editor.
export const Route = createFileRoute('/admin/automation_/workflows/$workflowId')({
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(workflowDetailQuery(params.workflowId)),
      context.queryClient.ensureQueryData(settingsQueries.workflowAbandonedAutoClose()),
    ])
    return {}
  },
  component: WorkflowBuilderPage,
})

/** Gate behind the `supportInbox` flag, mirroring the workflows list route. */
function WorkflowBuilderPage() {
  const { workflowId } = Route.useParams()
  const { settings } = Route.useRouteContext()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  if (!flags?.supportInbox) {
    return <Navigate to="/admin/automation/agent" />
  }
  return (
    <Suspense
      fallback={
        <div className="flex h-full flex-col gap-3 p-4">
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="min-h-0 flex-1 rounded-lg" />
        </div>
      }
    >
      <WorkflowBuilder workflowId={workflowId} />
    </Suspense>
  )
}
