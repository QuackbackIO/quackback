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
 * The standalone ticket components (`TicketListColumn`, `NewTicketDialog`, …)
 * are no longer imported here — `TicketDetail` still lives on disk for the
 * interim thread-fold in `routes/admin/inbox.tsx` (M2); the rest are unused
 * until M4-M6 finish the cleanup pass (§4).
 */
interface TicketsRedirectSearch {
  t?: string
}

export const Route = createFileRoute('/admin/tickets')({
  validateSearch: (search: Record<string, unknown>): TicketsRedirectSearch => ({
    t: typeof search.t === 'string' && isValidTypeId(search.t, 'ticket') ? search.t : undefined,
  }),
  loader: async () => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin', 'member'] } })
    return {}
  },
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
