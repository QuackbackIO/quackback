import { createFileRoute } from '@tanstack/react-router'
import { redirectMoved } from '@/lib/shared/moved-route'

/** Retired path: connectors live under Settings. The query string carries the OAuth result. */
export const Route = createFileRoute('/admin/automation/connectors_/$connectorId')({
  beforeLoad: ({ location, params }) =>
    redirectMoved(`/admin/settings/connectors/${encodeURIComponent(params.connectorId)}`, location),
})
