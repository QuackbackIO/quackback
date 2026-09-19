/**
 * Effects nobody has confirmed, on the page an operator opens first
 * (QUINN-PRODUCT Step 11, P8).
 *
 * An unconfirmed effect is the one Quinn state that never resolves itself: the
 * action may or may not have happened, nothing will retry it, and it waits for
 * a person indefinitely. That makes it exactly the thing an overview should
 * say, and only when there is one, so a healthy workspace sees nothing.
 *
 * It reads the same permission-scoped review queue the inbox column does, so
 * the count is what THIS teammate can actually act on rather than a workspace
 * total they cannot open.
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { assistantPendingActionQueries } from '@/lib/client/queries/assistant-pending-actions'

export function QuinnUnconfirmedSignal() {
  const queue = useQuery(assistantPendingActionQueries.reviewQueue())
  const unconfirmed = queue.data?.unconfirmed.length ?? 0
  if (unconfirmed === 0) return null
  return (
    <p className="text-sm">
      {unconfirmed === 1
        ? 'One action was sent and never confirmed.'
        : `${unconfirmed} actions were sent and never confirmed.`}{' '}
      <Link
        to="/admin/inbox"
        search={{ view: 'needs_approval' }}
        className="text-primary font-medium"
      >
        Review them
      </Link>
    </p>
  )
}
