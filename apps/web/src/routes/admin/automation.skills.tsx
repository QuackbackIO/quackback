import { createFileRoute } from '@tanstack/react-router'
import { redirectMoved } from '@/lib/shared/moved-route'
import { adminPageHead } from '@/lib/client/admin-head'

/** Retired path: this page lives under Settings. */
export const Route = createFileRoute('/admin/automation/skills')({
  head: adminPageHead('Automation: Skills'),
  beforeLoad: ({ location }) => redirectMoved('/admin/settings/skills', location),
})
