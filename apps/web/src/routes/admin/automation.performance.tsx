import { createFileRoute } from '@tanstack/react-router'
import { redirectMoved } from '@/lib/shared/moved-route'
import { adminPageHead } from '@/lib/client/admin-head'

/** Retired path: AI performance is the AI section of Analytics. */
export const Route = createFileRoute('/admin/automation/performance')({
  head: adminPageHead('Automation: Performance'),
  beforeLoad: () => redirectMoved('/admin/analytics?section=ai', {}),
})
