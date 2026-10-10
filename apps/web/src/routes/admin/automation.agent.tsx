import { createFileRoute } from '@tanstack/react-router'
import { redirectMoved } from '@/lib/shared/moved-route'
import { adminPageHead } from '@/lib/client/admin-head'

/** Retired path: the Agent lives under Settings. */
export const Route = createFileRoute('/admin/automation/agent')({
  head: adminPageHead('Automation: Agent'),
  beforeLoad: ({ location }) => redirectMoved('/admin/settings/agent', location),
})
