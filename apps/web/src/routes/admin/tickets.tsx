import { createFileRoute, Navigate } from '@tanstack/react-router'
import { isValidTypeId } from '@quackback/ids'
import type { FeatureFlags } from '@/lib/shared/types/settings'

/**
 * Retired route (UNIFIED-INBOX-SPEC.md §2.2/§4): tickets are now rows in the
 * unified `/admin/inbox` list, not a standalone page. This route is kept
 * permanently as a redirect (not deleted) so old bookmarks/links keep working:
 * `?t=<id>` deep-links become `?i=<id>`; a bare visit opens the Tickets >
 * Customer scope. Mirrors the `c=` → `i=` alias `/admin/inbox` itself accepts.
 *
 * The standalone ticket components (`TicketListColumn`, `TicketDetailPanel`, …)
 * are no longer imported here. `TicketDetail`/`ticket-thread.tsx` were deleted
 * in M4 (folded into the unified `agent-conversation-thread.tsx`); M5 folded
 * `TicketDetailPanel` into `inbox-detail-panel.tsx` and repurposed
 * `new-ticket-dialog.tsx` into `components/admin/inbox/create-ticket-dialog.tsx`
 * (still used, from the unified inbox); the rest are unused until M6 finishes
 * the cleanup pass (§4).
 */
interface TicketsRedirectSearch {
  t?: string
}

export const Route = createFileRoute('/admin/tickets')({
  validateSearch: (search: Record<string, unknown>): TicketsRedirectSearch => ({
    t: typeof search.t === 'string' && isValidTypeId(search.t, 'ticket') ? search.t : undefined,
  }),
  // Auth is enforced by the parent `/admin` guard; this route only redirects.
  component: TicketsRedirectRoute,
})

/** Gate on the `supportTickets` flag (matching today's behavior) and redirect
 *  into the unified inbox. */
function TicketsRedirectRoute() {
  const { settings } = Route.useRouteContext()
  const { t } = Route.useSearch()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  if (!flags?.supportTickets) {
    return <Navigate to="/admin/feedback" />
  }
  if (t) {
    return <Navigate to="/admin/inbox" search={{ i: t }} replace />
  }
  return <Navigate to="/admin/inbox" search={{ view: 'tickets_customer' }} replace />
}
