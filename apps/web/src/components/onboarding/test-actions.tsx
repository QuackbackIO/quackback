import { FormattedMessage } from 'react-intl'
import { Link } from '@tanstack/react-router'
import type { OnboardingOutcome } from '@/lib/shared/db-types'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { useFeatureFlags } from '@/lib/client/hooks/use-root-context'
import { buildLaunchTasks } from '@/lib/shared/launch-checklist'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import { useCanPostTestIdea, useOpenTryMessenger } from './try-messenger-button'
import type { TryMessengerStart } from './try-messenger-sheet'
import { launchStatusQuery } from './use-launch-plan'

/** Which test paths will work for the current person right now. */
export interface TestPaths {
  message: boolean
  idea: boolean
}

export function useTestPaths(flags: Partial<FeatureFlags> | undefined): TestPaths {
  const canTry = usePermission(PERMISSIONS.CONVERSATION_VIEW)
  const feedbackOn = flags?.feedback ?? true
  const canPostIdea = useCanPostTestIdea(canTry && feedbackOn)
  return {
    message: canTry && Boolean(flags?.supportInbox),
    idea: canTry && feedbackOn && canPostIdea,
  }
}

export type TourEnd =
  { kind: 'test'; start: TryMessengerStart } | { kind: 'article' } | { kind: 'service' }

/**
 * The tour end card's one action, for the primary goal: a test idea for
 * feedback, a test message for support, the first article for a help center
 * and a service for a status page. A test that cannot work falls back to the
 * other test, and to nothing when neither works.
 */
export function tourEndAction(
  goals: readonly OnboardingOutcome[],
  paths: TestPaths
): TourEnd | null {
  const primary = goals[0] ?? 'product_feedback'
  if (primary === 'help_center') return { kind: 'article' }
  if (primary === 'status_page') return { kind: 'service' }
  const order: TryMessengerStart[] =
    primary === 'customer_support' ? ['message', 'idea'] : ['idea', 'message']
  const start = order.find((candidate) => paths[candidate])
  return start ? { kind: 'test', start } : null
}

/** The test that matches the automatic first-win step, when it will work. */
export function firstWinTestStart(
  variant: string | undefined,
  paths: TestPaths
): TryMessengerStart | null {
  if (variant === 'feedback' || variant === 'private') return paths.idea ? 'idea' : null
  if (variant === 'support') return paths.message ? 'message' : null
  return null
}

function TestActionLabel({ start }: { start: TryMessengerStart }) {
  return start === 'idea' ? (
    <FormattedMessage id="onboarding.test.postTestIdea" defaultMessage="Post a test idea" />
  ) : (
    <FormattedMessage id="onboarding.test.sendTestMessage" defaultMessage="Send a test message" />
  )
}

/** The tour end card's one action; the admin layout loads it as the card opens. */
export function TourEndTestAction({
  goals,
  onOpen,
  onLeave,
}: {
  goals: readonly OnboardingOutcome[]
  onOpen: (start: TryMessengerStart) => void
  /** Closes the end card before an action that opens a page. */
  onLeave: () => void
}) {
  const action = tourEndAction(goals, useTestPaths(useFeatureFlags()))
  if (!action) return null
  if (action.kind === 'test') {
    const start = action.start
    return (
      <Button onClick={() => onOpen(start)}>
        <TestActionLabel start={start} />
      </Button>
    )
  }
  return (
    <Button asChild>
      {action.kind === 'article' ? (
        <Link to="/admin/help-center" onClick={onLeave}>
          <FormattedMessage
            id="onboarding.tour.stop.try.article"
            defaultMessage="Write your first article"
          />
        </Link>
      ) : (
        <Link to="/admin/status" search={{ view: 'components' }} onClick={onLeave}>
          <FormattedMessage id="onboarding.tour.stop.try.service" defaultMessage="Add a service" />
        </Link>
      )}
    </Button>
  )
}

/** The Launch plan's action for the automatic first-win step. */
export function FirstWinTestAction() {
  const { data: status } = useSuspenseQuery(launchStatusQuery())
  const variant = buildLaunchTasks(status).find((task) => task.id === 'first-win')?.variant
  const start = firstWinTestStart(variant, useTestPaths(useFeatureFlags()))
  const open = useOpenTryMessenger()
  if (!start) return null
  return (
    <Button size="sm" variant="outline" className="h-8" onClick={() => open(start)}>
      <TestActionLabel start={start} />
    </Button>
  )
}
