/**
 * The paused notice itself, loaded only for a workspace with the plan limits
 * flag on (see plan-feature-notice.tsx): its query, copy and markup never
 * reach a page otherwise.
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

/** The paid features whose settings pages carry the notice. */
export type PlanNoticeFeature =
  | 'webhooks'
  | 'workflows'
  | 'integrations'
  | 'customDomain'
  | 'customCss'
  | 'aiAssistant'
  | 'aiArticleTranslation'

/** The part of the Plan limits page state the notice reads. */
export interface PlanNoticeState {
  enabled: boolean
  phase: 'ok' | 'grace' | 'enforced'
  planName: string | null
  graceEndsAt: string | null
  featureIssues: ReadonlyArray<{ key: string }>
  canManageBilling: boolean
}

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
 * The day the feature pauses, as a sentence names it: "Nov 23" by the viewer's
 * locale, with the year only when it is not this year, at the UTC day the
 * grace end is stored at.
 */
function deadline(iso: string, format: LocalDateFormatter, now: Date): string {
  const sameYear = new Date(iso).getUTCFullYear() === now.getUTCFullYear()
  return format(iso, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  })
}

/**
 * The notice for `feature`, or null when there is nothing to say: the flag is
 * off, nothing is over the plan, or this feature is not set up past it.
 */
export function planFeatureNotice(
  feature: PlanNoticeFeature,
  state: PlanNoticeState | null | undefined,
  format: LocalDateFormatter = formatFirstRenderDate,
  now: Date = new Date()
): { text: string; showPlans: boolean } | null {
  if (!state?.enabled || state.phase === 'ok') return null
  if (!state.featureIssues.some((issue) => issue.key === feature)) return null
  const copy = COPY[feature]
  // A feature set up past the plan is live until the deadline and paused after.
  const sentences =
    state.phase === 'grace' && state.graceEndsAt
      ? [`${copy.pausing} on ${deadline(state.graceEndsAt, format, now)}.`, copy.pausingNote]
      : [
          state.planName ? `${copy.paused} on the ${state.planName} plan.` : `${copy.paused}.`,
          copy.back,
          copy.after,
        ]
  return { text: sentences.filter(Boolean).join(' '), showPlans: state.canManageBilling }
}

export default function PlanFeatureNoticeBody({ feature }: { feature: PlanNoticeFeature }) {
  const { data } = useQuery({
    queryKey: ['plan-limits', 'feature-notice'],
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
