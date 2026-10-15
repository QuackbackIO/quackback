import { createFileRoute } from '@tanstack/react-router'
import { redirectMoved } from '@/lib/shared/moved-route'

/**
 * Retired path: connectors are Quackback AI, Actions. The query string (an
 * OAuth return) travels with the visit. The connector page keeps its path.
 */
export const Route = createFileRoute('/admin/settings/connectors')({
  beforeLoad: ({ location }) => redirectMoved('/admin/settings/ai/actions', location),
})
