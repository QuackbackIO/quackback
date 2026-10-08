import { Link } from '@tanstack/react-router'
import { FormattedMessage } from 'react-intl'
import { PauseCircleIcon } from '@heroicons/react/24/outline'
import { useLocalDateFormatter } from '@/components/ui/local-date'
import { useBillingEnabled } from '@/lib/client/hooks/use-root-context'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { cn } from '@/lib/shared/utils'

/**
 * Copilot in the composer's place once this period's AI allowance is used:
 * that it is paused and until when, in plain sight, and the way to the usage
 * for whoever manages billing. A trial's allowance runs to the trial's end,
 * which is no reset, so no day is named then.
 */
export function CopilotPaused({
  resetsAt,
  trial = false,
}: {
  resetsAt: string | null
  trial?: boolean
}) {
  const formatDate = useLocalDateFormatter()
  const billingEnabled = useBillingEnabled()
  const canBill = usePermission(PERMISSIONS.BILLING_MANAGE)
  // The day it comes back where the viewer is.
  const date = resetsAt && !trial ? formatDate(resetsAt, { month: 'short', day: 'numeric' }) : null
  const usage = billingEnabled && canBill
  return (
    <div
      role="status"
      className={cn(
        'flex min-h-[138px] flex-col gap-3 rounded-2xl border border-border bg-card p-5 [--ring:var(--muted-foreground)]',
        usage ? 'justify-between' : 'justify-center'
      )}
    >
      <div className="flex gap-3">
        <PauseCircleIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="space-y-1">
          <p className="font-medium">
            {trial ? (
              <FormattedMessage
                id="ask.paused.trial"
                defaultMessage="Copilot is paused for the rest of your trial."
              />
            ) : date ? (
              <FormattedMessage
                id="ask.paused.until"
                defaultMessage="Copilot is paused until {date}."
                values={{ date }}
              />
            ) : (
              <FormattedMessage id="ask.paused.now" defaultMessage="Copilot is paused." />
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            <FormattedMessage
              id="ask.paused.reason"
              defaultMessage="This period’s AI allowance is used up."
            />
          </p>
        </div>
      </div>
      {usage ? (
        <Link
          to="/admin/settings/billing"
          search={{ checkout: undefined, billing_error: undefined }}
          className="ms-8 w-fit text-sm font-medium underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FormattedMessage id="ask.paused.usage" defaultMessage="See usage" />
        </Link>
      ) : null}
    </div>
  )
}
