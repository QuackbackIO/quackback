import { createFileRoute } from '@tanstack/react-router'
import { redirectMoved } from '@/lib/shared/moved-route'
import { adminPageHead } from '@/lib/client/admin-head'

/** Retired path: this page lives under Settings. */
export const Route = createFileRoute('/admin/settings/ai')({
  head: adminPageHead('AI settings'),
  beforeLoad: ({ location }) => redirectMoved('/admin/settings/agent', location),
})
