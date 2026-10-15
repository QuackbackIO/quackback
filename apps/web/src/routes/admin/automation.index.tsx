import { createFileRoute } from '@tanstack/react-router'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { redirectMoved } from '@/lib/shared/moved-route'
import { adminPageHead } from '@/lib/client/admin-head'

/** Retired path: lands on the first AI & Automation page the viewer can open. */
export const Route = createFileRoute('/admin/automation/')({
  head: adminPageHead('Automation'),
  beforeLoad: ({ context, location }) => {
    const permissions: readonly string[] = context.permissions ?? []
    if (permissions.includes(PERMISSIONS.AI_CUSTOMER_MANAGE)) {
      redirectMoved('/admin/settings/ai/customers', location)
    }
    if (permissions.includes(PERMISSIONS.AI_TEAMMATE_MANAGE)) {
      redirectMoved('/admin/settings/ai/teammates', location)
    }
    if (
      permissions.includes(PERMISSIONS.WORKFLOW_MANAGE) &&
      isProductEnabled(context.settings?.featureFlags, 'support')
    ) {
      redirectMoved('/admin/settings/workflows', location)
    }
    redirectMoved('/admin/settings', location)
  },
})
