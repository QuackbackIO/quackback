import { createFileRoute } from '@tanstack/react-router'
import { redirectMoved } from '@/lib/shared/moved-route'

/** Retired path: ticket statuses are a part of Tickets. */
export const Route = createFileRoute('/admin/settings/ticket-statuses')({
  beforeLoad: ({ location }) => redirectMoved('/admin/settings/tickets', location),
})
