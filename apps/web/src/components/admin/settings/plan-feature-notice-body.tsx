/**
 * The paused notice itself, loaded only for a workspace with plan billing on
 * (each page checks first): its query, copy and markup never reach a page
 * otherwise.
 */
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  formatFirstRenderDate,
  useLocalDateFormatter,
  type LocalDateFormatter,
} from '@/components/ui/local-date'
import { getPlanLimitsFn } from '@/lib/server/functions/plan-limits'
import type { PlanNoticeState } from './plan-feature-notice-state'

export type { PlanNoticeState }

// The query key and the rule below match plan-feature-notice-state.ts, a
// parity test holds them together. They are copied rather than imported: a
// module shared with the Custom domains tab, which loads that one, would
// become a chunk of its own and cost that tab a request with the flag off.

/** The query the notice and the pages that defer to it share. */
export const PLAN_FEATURE_NOTICE_QUERY_KEY = ['plan-limits', 'feature-notice'] as const

/** Whether the notice shows for `feature` (see plan-feature-notice-state.ts). */
export function planFeatureNoticeApplies(
  feature: string,
  state: PlanNoticeState | null | undefined
): boolean {
  if (!state?.enabled || state.phase === 'ok') return false
  return state.featureIssues.some((issue) => issue.key === feature)
}

/** The paid features whose settings pages carry the notice. */
export type PlanNoticeFeature =
  | 'webhooks'
  | 'workflows'
  | 'integrations'
  | 'customDomain'
  | 'customCss'
  | 'aiAssistant'
  | 'aiArticleTranslation'

const THEY_COME_BACK = 'They come back when you upgrade.'
const IT_COMES_BACK = 'It comes back when you upgrade.'

/** Each feature's subject, as it starts a sentence, and what follows. */
const COPY: Record<
  PlanNoticeFeature,
  { pausing: string; paused: string; back: string; after?: string; pausingNote?: string }
> = {
  webhooks: { pausing: 'Webhooks pause', paused: 'Webhooks are paused', back: THEY_COME_BACK },
  workflows: {
    pausing: 'Workflows pause',
    paused: 'Workflows are paused',
    back: THEY_COME_BACK,
    after: 'Runs that were waiting have stopped.',
    pausingNote: 'Runs waiting at that point stop.',
  },
  integrations: {
    pausing: 'Integrations pause',
    paused: 'Integrations are paused',
    back: THEY_COME_BACK,
  },
  customDomain: {
    pausing: 'Your custom domain pauses',
    paused: 'Your custom domain is paused',
    back: IT_COMES_BACK,
  },
  customCss: { pausing: 'Custom CSS pauses', paused: 'Custom CSS is paused', back: IT_COMES_BACK },
  aiAssistant: {
    pausing: 'The AI assistant pauses',
    paused: 'The AI assistant is paused',
    back: IT_COMES_BACK,
    after: 'Conversations go to your team.',
  },
  aiArticleTranslation: {
    pausing: 'AI article translation pauses',
    paused: 'AI article translation is paused',
    back: IT_COMES_BACK,
    after: 'Published translations stay.',
  },
}

/**
 * The last full day before the feature pauses, as a sentence names it: "Nov
 * 23" by the viewer's locale, with the year only when it is not this year. It
 * is a plain calendar date, so it is formatted in UTC and reads the same in
 * every zone.
 */
function deadline(day: string, format: LocalDateFormatter, now: Date): string {
  const date = new Date(`${day}T12:00:00.000Z`)
  const sameYear = date.getUTCFullYear() === now.getUTCFullYear()
  return format(date, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  })
}

/**
 * The notice for `feature`, or null when there is nothing to say: no plan
 * billing, nothing is over the plan, or this feature is not set up past it.
 */
export function planFeatureNotice(
  feature: PlanNoticeFeature,
  state: PlanNoticeState | null | undefined,
  format: LocalDateFormatter = formatFirstRenderDate,
  now: Date = new Date()
): { text: string; showPlans: boolean } | null {
  if (!state || !planFeatureNoticeApplies(feature, state)) return null
  const copy = COPY[feature]
  // A feature set up past the plan is live until the deadline and paused after.
  const sentences =
    state.phase === 'grace' && state.deadlineDay
      ? [`${copy.pausing} after ${deadline(state.deadlineDay, format, now)}.`, copy.pausingNote]
      : [
          state.planName ? `${copy.paused} on the ${state.planName} plan.` : `${copy.paused}.`,
          copy.back,
          copy.after,
        ]
  return { text: sentences.filter(Boolean).join(' '), showPlans: state.canManageBilling }
}

export default function PlanFeatureNoticeBody({ feature }: { feature: PlanNoticeFeature }) {
  const { data } = useQuery({
    queryKey: PLAN_FEATURE_NOTICE_QUERY_KEY,
    queryFn: () => getPlanLimitsFn(),
    staleTime: 60_000,
    retry: false,
  })
  const format = useLocalDateFormatter()
  const notice = planFeatureNotice(feature, data, format)
  if (!notice) return null
  return (
    <Alert role="status">
      <AlertDescription className="block">
        {notice.text}
        {notice.showPlans && (
          <>
            {' '}
            <Link
              to="/admin/settings/billing"
              search={{ checkout: undefined, billing_error: undefined }}
              className="font-medium text-foreground underline underline-offset-2"
            >
              Upgrade
            </Link>
          </>
        )}
      </AlertDescription>
    </Alert>
  )
}
