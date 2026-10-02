import { createFileRoute } from '@tanstack/react-router'
import { redirectMoved } from '@/lib/shared/moved-route'

/** Retired path: the workflow builder lives under Settings. */
export const Route = createFileRoute('/admin/automation_/workflows/$workflowId')({
  beforeLoad: ({ location, params }) =>
    redirectMoved(`/admin/settings/workflows/${encodeURIComponent(params.workflowId)}`, location),
})
