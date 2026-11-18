/**
 * One quiet line at the top of a paid feature's settings page while that
 * feature is paused after the plan limits grace, or will pause when the grace
 * ends. Nothing shows otherwise.
 */
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Alert, AlertDescription } from '@/components/ui/alert'
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

const COPY: Record<
  PlanNoticeFeature,
  { pausing: string; paused: string; kept: string; pausingNote?: string }
> = {
  webhooks: {
    pausing: 'Webhooks pause',
    paused: 'Webhooks are paused',
    kept: "They're kept and start again when you upgrade.",
  },
  workflows: {
    pausing: 'Workflows pause',
    paused: 'Workflows are paused',
    kept: "They're kept and start again when you upgrade. Runs that were waiting have stopped.",
    pausingNote: 'Runs waiting at that point stop.',
  },
  integrations: {
    pausing: 'Integrations pause',
    paused: 'Integrations are paused',
    kept: 'They stay connected and start again when you upgrade.',
  },
  customDomain: {
    pausing: 'Your custom domain pauses',
    paused: 'Your custom domain is paused',
    kept: "It's kept and serves again when you upgrade.",
  },
  customCss: {
    pausing: 'Custom CSS pauses',
    paused: 'Custom CSS is paused',
    kept: "It's kept and applies again when you upgrade.",
  },
  aiAssistant: {
    pausing: 'The AI assistant pauses',
    paused: 'The AI assistant is paused',
    kept: 'Conversations go to your team. It answers again when you upgrade.',
  },
  aiArticleTranslation: {
    pausing: 'AI article translation pauses',
    paused: 'AI article translation is paused',
    kept: 'Published translations stay, and it starts again when you upgrade.',
  },
}

/** The grace end as a calendar day: it is stored at a UTC instant. */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

/**
 * The notice for `feature`, or null when there is nothing to say: the flag is
 * off, nothing is over the plan, or this feature is not set up past it.
 */
export function planFeatureNotice(
  feature: PlanNoticeFeature,
  state: PlanNoticeState | null | undefined
): { text: string; showPlans: boolean } | null {
  if (!state?.enabled || state.phase === 'ok') return null
  if (!state.featureIssues.some((issue) => issue.key === feature)) return null
  const copy = COPY[feature]
  const plan = state.planName ? `the ${state.planName} plan` : 'your current plan'
  // A feature set up past the plan is live through the grace and paused after.
  const text =
    state.phase === 'grace' && state.graceEndsAt
      ? `${copy.pausing} on ${shortDate(state.graceEndsAt)} unless you choose a plan.${copy.pausingNote ? ` ${copy.pausingNote}` : ''}`
      : `${copy.paused} on ${plan}. ${copy.kept}`
  return { text, showPlans: state.canManageBilling }
}

export function PlanFeatureNotice({ feature }: { feature: PlanNoticeFeature }) {
  const { data } = useQuery({
    queryKey: ['plan-limits', 'feature-notice'],
    queryFn: () => getPlanLimitsFn(),
    staleTime: 60_000,
    retry: false,
  })
  const notice = planFeatureNotice(feature, data)
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
              See plans
            </Link>
          </>
        )}
      </AlertDescription>
    </Alert>
  )
}
