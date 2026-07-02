/**
 * Helper that translates ticket-mutation errors into UX-friendly toasts. When
 * the server reports a `ConflictError` (stale `expectedUpdatedAt`), we surface
 * a "Refresh" action that re-fetches the ticket detail. Other errors fall
 * through to a plain error toast.
 */
import { toast } from 'sonner'
import type { QueryClient } from '@tanstack/react-query'
import type { TicketId } from '@quackback/ids'
import { ticketQueries } from '@/lib/client/queries/tickets'

export function handleTicketConflict(error: unknown, qc: QueryClient, ticketId: TicketId): void {
  const message = error instanceof Error ? error.message : String(error)
  const code = (error as { code?: string } | null)?.code
  const isConflict =
    code === 'TICKET_CONFLICT' ||
    code === 'CONFLICT' ||
    /conflict|stale|version|expectedupdatedat/i.test(message)

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ticketQueries.detail(ticketId).queryKey })
    qc.invalidateQueries({ queryKey: ticketQueries.threads(ticketId).queryKey })
    qc.invalidateQueries({ queryKey: ticketQueries.activity(ticketId).queryKey })
  }

  if (isConflict) {
    toast.error('Ticket was changed by someone else.', {
      description: 'Refresh to get the latest version.',
      action: { label: 'Refresh', onClick: refresh },
    })
    return
  }

  toast.error(message)
}
