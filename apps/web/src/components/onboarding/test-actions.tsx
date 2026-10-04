import { FormattedMessage } from 'react-intl'
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

/**
 * The tour end card's next step: a test message, or a test idea when the
 * workspace's feedback is private. An idea that cannot land falls back to a
 * message, and to nothing when neither works.
 */
export function tourTestStart(
  paths: TestPaths,
  feedbackPrivate: boolean
): TryMessengerStart | null {
  if (feedbackPrivate && paths.idea) return 'idea'
  return paths.message ? 'message' : null
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

/** The tour end card's test action; the admin layout loads it as the card opens. */
export function TourEndTestAction({
  feedbackPrivate,
  onOpen,
}: {
  feedbackPrivate: boolean
  onOpen: (start: TryMessengerStart) => void
}) {
  const start = tourTestStart(useTestPaths(useFeatureFlags()), feedbackPrivate)
  if (!start) return null
  return (
    <Button onClick={() => onOpen(start)}>
      <TestActionLabel start={start} />
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
