import { createFileRoute } from '@tanstack/react-router'
import { redirectMoved } from '@/lib/shared/moved-route'

/** Retired path: this page lives under Settings. */
export const Route = createFileRoute('/admin/automation/workflows')({
  beforeLoad: ({ location }) => redirectMoved('/admin/settings/workflows', location),
})
