import { createFileRoute } from '@tanstack/react-router'
import { redirectMoved } from '@/lib/shared/moved-route'
import { adminPageHead } from '@/lib/client/admin-head'

/** Retired path: this page lives under Settings. */
export const Route = createFileRoute('/admin/automation/workflows')({
  head: adminPageHead('Automation: Workflows'),
  beforeLoad: ({ location }) => redirectMoved('/admin/settings/workflows', location),
})
