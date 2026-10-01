import { createFileRoute } from '@tanstack/react-router'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { redirectMoved } from '@/lib/shared/moved-route'

/** Retired path: lands on the first AI & Automation page the viewer can open. */
export const Route = createFileRoute('/admin/automation/')({
  beforeLoad: ({ context, location }) => {
    const permissions: readonly string[] = context.permissions ?? []
    if (permissions.includes(PERMISSIONS.ASSISTANT_MANAGE)) {
      redirectMoved('/admin/settings/agent', location)
    }
    if (
      permissions.includes(PERMISSIONS.WORKFLOW_MANAGE) &&
      context.settings?.featureFlags?.supportInbox
    ) {
      redirectMoved('/admin/settings/workflows', location)
    }
    redirectMoved('/admin/settings', location)
  },
})
