import { createFileRoute } from '@tanstack/react-router'
import { redirectMoved } from '@/lib/shared/moved-route'

/** Retired path: the Agent lives under Settings. */
export const Route = createFileRoute('/admin/automation/agent')({
  beforeLoad: ({ location }) => redirectMoved('/admin/settings/agent', location),
})
