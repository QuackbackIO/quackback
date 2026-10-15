import { createFileRoute } from '@tanstack/react-router'
import { redirectMoved } from '@/lib/shared/moved-route'

/** Retired path: ticket types are a part of Tickets. */
export const Route = createFileRoute('/admin/settings/ticket-types')({
  beforeLoad: ({ location }) => redirectMoved('/admin/settings/tickets', location),
})
