import { createFileRoute, Navigate } from '@tanstack/react-router'
import { WorkflowBuilder } from '@/components/admin/automation/workflow-builder/workflow-builder'
import { workflowDetailQuery } from '@/lib/client/queries/workflows'
import type { FeatureFlags } from '@/lib/shared/types/settings'

// The trailing underscore on "automation_" escapes nesting under
// /admin/automation's sidebar layout (routes/admin/automation.tsx): this
// route renders fullscreen in the admin shell instead, like the help center
// article editor.
export const Route = createFileRoute('/admin/automation_/workflows/$workflowId')({
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(workflowDetailQuery(params.workflowId))
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
  return <WorkflowBuilder workflowId={workflowId} />
}
