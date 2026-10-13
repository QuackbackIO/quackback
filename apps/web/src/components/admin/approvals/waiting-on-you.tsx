import { useId } from 'react'
import { useIntl } from 'react-intl'
import { Link } from '@tanstack/react-router'
import { getShortTimeAgo } from '@/components/ui/time-ago'
import { approvalMessages } from './approval-messages'
import { askedBy } from './approval-people'
import { ApprovalRiskChip } from './approval-risk-chip'
import { useWaitingApprovals } from './use-waiting-approvals'

/**
 * Home's "Waiting on you": the newest requests the viewer may decide, each a
 * way into Approvals. It reads the answer the admin layout already holds, so
 * Home renders without waiting for it, and shows nothing while nothing waits.
 */
export function WaitingOnYou({ className }: { className?: string } = {}) {
  const intl = useIntl()
  const headingId = useId()
  const waiting = useWaitingApprovals()
  if (!waiting || waiting.count === 0 || waiting.latest.length === 0) return null
  return (
    <section aria-labelledby={headingId} data-slot="waiting-on-you" className={className}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <h2 id={headingId} className="text-[13px] font-medium text-muted-foreground">
          {intl.formatMessage({
            id: 'admin.overview.waiting.title',
            defaultMessage: 'Waiting on you',
          })}
        </h2>
        <Link
          to="/admin/approvals"
          className="rounded-sm text-[13px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {intl.formatMessage(approvalMessages.title)}
        </Link>
      </div>
      <ul>
        {waiting.latest.map((approval) => (
          <li key={approval.id}>
            <Link
              to="/admin/approvals"
              search={{ id: approval.id }}
              className="-mx-2.5 flex min-h-[42px] items-center gap-3 rounded-lg px-2.5 py-1.5 text-sm text-foreground/90 transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ApprovalRiskChip risk={approval.risk} />
              {/* The title comes first: on a phone who asked moves to a line below it. */}
              <span className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-3">
                <span className="block truncate sm:min-w-0 sm:flex-1">{approval.summary}</span>
                <span className="block truncate text-xs text-muted-foreground sm:max-w-[40%] sm:shrink-0">
                  {askedBy(approval, intl)} · {getShortTimeAgo(approval.proposedAt, intl.locale)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
