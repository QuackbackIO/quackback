import { createFileRoute } from '@tanstack/react-router'
import { redirectMoved } from '@/lib/shared/moved-route'
import { adminPageHead } from '@/lib/client/admin-head'

/** Retired path: this page lives under Settings. */
export const Route = createFileRoute('/admin/automation/assistant')({
  head: adminPageHead('Assistant'),
  beforeLoad: ({ location }) => redirectMoved('/admin/settings/agent', location),
})
