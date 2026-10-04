import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { FormattedMessage } from 'react-intl'
import { Button } from '@/components/ui/button'
import { ActivationActionButton } from '@/components/admin/activation-action-button'
import { copyBoardLinkAction } from '@/lib/shared/activation-action'
import {
  launchChecklistSummary,
  type LaunchStatus,
  type LaunchTask,
} from '@/lib/shared/launch-checklist'

/**
 * The one action a launch step offers: copy the board link, create the board,
 * or open the page that does the step. The automatic first win takes its
 * action from the caller. Null for a step that is done, skipped or blocked.
 */
export function LaunchStepAction({
  task,
  status,
  primary,
  pending = false,
  firstWinAction,
  onCreateBoard,
}: {
  task: LaunchTask
  status: LaunchStatus
  primary: boolean
  pending?: boolean
  firstWinAction?: ReactNode
  onCreateBoard: () => void
}): ReactNode {
  if (task.isCompleted || task.isSkipped || task.availability === 'blocked') return null
  if (task.classification === 'first_win') return firstWinAction ?? null
  const variant = primary ? 'default' : 'outline'
  const copy =
    task.id === 'distribute-feedback'
      ? copyBoardLinkAction(launchChecklistSummary(status).outcome, status)
      : null
  if (copy) {
    return (
      <ActivationActionButton
        action={copy}
        surface="launch_plan"
        variant={variant}
        className="h-8"
      />
    )
  }
  if (task.id === 'create-board') {
    return (
      <Button size="sm" variant={variant} disabled={pending} onClick={onCreateBoard}>
        <FormattedMessage id="onboarding.launch.start" defaultMessage="Start" />
      </Button>
    )
  }
  if (!task.href) return null
  return (
    <Button asChild size="sm" variant={variant}>
      <Link to={task.href}>
        <FormattedMessage id="onboarding.launch.start" defaultMessage="Start" />
      </Link>
    </Button>
  )
}
