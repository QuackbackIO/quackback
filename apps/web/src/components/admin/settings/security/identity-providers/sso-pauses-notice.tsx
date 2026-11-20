/**
 * The grace notice for single sign-on, loaded only when a provider set up
 * past the plan is still working (see provider-list.tsx). It reads the same
 * query as the paused feature notices but imports nothing of theirs, so their
 * chunks stay as they are on every other settings page.
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { useLocalDateFormatter, type LocalDateFormatter } from '@/components/ui/local-date'
import { getPlanLimitsFn } from '@/lib/server/functions/plan-limits'

/** The paused notices' query key (`PLAN_FEATURE_NOTICE_QUERY_KEY`), so the two share one read. */
export const SSO_NOTICE_QUERY_KEY = ['plan-limits', 'feature-notice'] as const

/**
 * The last full day as a sentence names it: "Nov 22" in the viewer's locale,
 * with the year only when it is not this year. A plain calendar date, so it is
 * formatted in UTC and reads the same in every zone.
 */
export function ssoPausesText(day: string, format: LocalDateFormatter, now = new Date()): string {
  const date = new Date(`${day}T12:00:00.000Z`)
  const sameYear = date.getUTCFullYear() === now.getUTCFullYear()
  const shown = format(date, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  })
  return `Single sign-on pauses after ${shown}.`
}

/**
 * A provider set up before the plan dropped single sign-on keeps signing in
 * until the plan limits deadline. The notice names the last day; the provider
 * list shows it working as before. Someone who can change the plan gets
 * Upgrade and everyone else is told who can.
 */
export default function SsoPausesNotice() {
  const { data } = useQuery({
    queryKey: SSO_NOTICE_QUERY_KEY,
    queryFn: () => getPlanLimitsFn(),
    staleTime: 60_000,
    retry: false,
  })
  const format = useLocalDateFormatter()
  if (!data?.enabled || data.phase !== 'grace' || !data.deadlineDay) return null
  if (!data.featureIssues.some((issue) => issue.key === 'sso')) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border/50 bg-muted/10 p-5">
      <div className="min-w-0 space-y-1 text-sm text-muted-foreground">
        <p>{ssoPausesText(data.deadlineDay, format)}</p>
        {data.canManageBilling ? null : <p>Ask someone who manages billing to upgrade.</p>}
      </div>
      {data.canManageBilling ? (
        <Button asChild size="sm" variant="outline">
          <Link
            to="/admin/settings/billing"
            search={{ checkout: undefined, billing_error: undefined }}
          >
            Upgrade
          </Link>
        </Button>
      ) : null}
    </div>
  )
}
