import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { FormattedMessage, useIntl } from 'react-intl'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { CheckIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { ActivationActionButton } from '@/components/admin/activation-action-button'
import { CreateBoardDialog } from '@/components/admin/settings/boards/create-board-dialog'
import { copyBoardLinkAction } from '@/lib/shared/activation-action'
import {
  launchChecklistSummary,
  launchPlanGroups,
  launchPlanProgress,
  type LaunchPlanGroupId,
  type LaunchStatus,
  type LaunchTask,
} from '@/lib/shared/launch-checklist'
import { cn } from '@/lib/shared/utils'
import { LaunchTaskLabel, launchTaskMessage } from './launch-task-label'
import { useProductTour } from './product-tour'
import { openGoingLiveSheet } from './going-live-events'
import { launchStatusQuery, useLaunchTaskResolution } from './use-launch-plan'

const GROUP_NAME: Record<LaunchPlanGroupId, { id: string; defaultMessage: string }> = {
  product_feedback: { id: 'onboarding.launch.group.feedback', defaultMessage: 'Feedback' },
  customer_support: { id: 'onboarding.launch.group.support', defaultMessage: 'Support' },
  help_center: { id: 'onboarding.launch.group.helpCenter', defaultMessage: 'Help Center' },
  status_page: { id: 'onboarding.launch.group.status', defaultMessage: 'Status' },
  polish: { id: 'onboarding.launch.group.polish', defaultMessage: 'Polish' },
}

const isOpen = (task: LaunchTask) => !task.isCompleted && !task.isSkipped

/**
 * The whole launch plan, one row per step with one action, grouped by goal
 * then Polish. Automatic steps say they complete themselves.
 */
export function LaunchPlanPage({
  firstWinAction,
}: {
  /** An action for the automatic first-win step, such as sending a test message. */
  firstWinAction?: ReactNode
}) {
  const intl = useIntl()
  const tour = useProductTour()
  const queryClient = useQueryClient()
  const { data: status } = useSuspenseQuery(launchStatusQuery())
  const resolution = useLaunchTaskResolution()
  const [createBoardOpen, setCreateBoardOpen] = useState(false)
  const groups = launchPlanGroups(status)
  const progress = launchPlanProgress(status)
  const outcome = launchChecklistSummary(status).outcome
  const canSkip = status.permissions?.settingsManage !== false
  const nextTaskId = groups
    .flatMap((group) => group.tasks)
    .find(
      (task) =>
        isOpen(task) && task.availability === 'available' && task.classification !== 'first_win'
    )?.id
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="mx-auto w-full max-w-3xl space-y-7 px-4 pb-14 pt-8 [--ring:var(--muted-foreground)] sm:px-6 sm:pt-10">
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-1 space-y-2.5">
          <h1 className="text-2xl font-semibold">
            <FormattedMessage id="onboarding.launch.name" defaultMessage="Launch plan" />
          </h1>
          <div className="flex items-center gap-3">
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
              aria-labelledby="launch-plan-progress"
              className="h-1.5 w-56 max-w-full overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-foreground motion-safe:transition-[width]"
                style={{ width: `${percent}%` }}
              />
            </div>
            <span id="launch-plan-progress" className="text-sm text-muted-foreground">
              <FormattedMessage
                id="onboarding.launch.progressDone"
                defaultMessage="{done} of {total} done"
                values={{ done: progress.done, total: progress.total }}
              />
            </span>
          </div>
        </div>
        <Button variant="outline" onClick={() => tour?.start()}>
          <FormattedMessage id="onboarding.tour.replay" defaultMessage="Replay the tour" />
        </Button>
      </header>

      {groups.map((group) => (
        <section key={group.id} aria-labelledby={`launch-group-${group.id}`}>
          <h2
            id={`launch-group-${group.id}`}
            className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {intl.formatMessage(GROUP_NAME[group.id])}
          </h2>
          <ul>
            {group.tasks.map((task) => (
              <LaunchPlanRow
                key={task.id}
                task={task}
                status={status}
                outcome={outcome}
                next={task.id === nextTaskId}
                canSkip={canSkip}
                pending={resolution.isPending}
                firstWinAction={firstWinAction}
                onSkip={(resolved) =>
                  resolution.mutate({ taskId: task.id, resolution: resolved ? 'dismissed' : null })
                }
                onCreateBoard={() => setCreateBoardOpen(true)}
              />
            ))}
          </ul>
        </section>
      ))}

      <CreateBoardDialog
        open={createBoardOpen}
        onOpenChange={setCreateBoardOpen}
        redirectOnCreate={false}
        onCreated={() => {
          void queryClient.invalidateQueries({ queryKey: ['admin', 'onboarding'] })
        }}
      />
    </div>
  )
}

function LaunchPlanRow({
  task,
  status,
  outcome,
  next,
  canSkip,
  pending,
  firstWinAction,
  onSkip,
  onCreateBoard,
}: {
  task: LaunchTask
  status: LaunchStatus
  outcome: ReturnType<typeof launchChecklistSummary>['outcome']
  next: boolean
  canSkip: boolean
  pending: boolean
  firstWinAction?: ReactNode
  onSkip: (skipped: boolean) => void
  onCreateBoard: () => void
}) {
  const intl = useIntl()
  const open = isOpen(task)
  const automatic = task.classification === 'first_win'
  const blocked = open && task.availability === 'blocked'
  const variant = next ? 'default' : 'outline'
  const copy = task.id === 'distribute-feedback' ? copyBoardLinkAction(outcome, status) : null

  let action: ReactNode = null
  if (open && !blocked) {
    if (automatic) action = firstWinAction ?? null
    else if (copy) {
      action = (
        <ActivationActionButton
          action={copy}
          surface="launch_plan"
          variant={variant}
          className="h-8"
        />
      )
    } else if (task.id === 'create-board') {
      action = (
        <Button size="sm" variant={variant} disabled={pending} onClick={onCreateBoard}>
          <FormattedMessage id="onboarding.launch.start" defaultMessage="Start" />
        </Button>
      )
    } else if (task.sheet) {
      const sheet = task.sheet
      action = (
        <Button size="sm" variant={variant} onClick={() => openGoingLiveSheet(sheet)}>
          <FormattedMessage id="onboarding.launch.start" defaultMessage="Start" />
        </Button>
      )
    } else if (task.href) {
      action = (
        <Button asChild size="sm" variant={variant}>
          <Link to={task.href}>
            <FormattedMessage id="onboarding.launch.start" defaultMessage="Start" />
          </Link>
        </Button>
      )
    }
  }

  const note = task.isSkipped ? (
    <FormattedMessage id="onboarding.launch.skipped" defaultMessage="Skipped" />
  ) : blocked && task.blocked?.kind === 'permission' ? (
    <FormattedMessage
      id="onboarding.launch.adminNeeded"
      defaultMessage="Ask a workspace admin to complete this step."
    />
  ) : automatic && open ? (
    <FormattedMessage id="onboarding.launch.auto" defaultMessage="Marked done when it happens" />
  ) : null

  return (
    <li className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 py-1.5">
      <span
        aria-hidden="true"
        className={cn(
          'flex size-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px]',
          task.isCompleted
            ? 'border-foreground bg-foreground text-background'
            : next
              ? 'border-foreground'
              : 'border-border'
        )}
      >
        {task.isCompleted ? <CheckIcon className="size-3" /> : null}
      </span>
      <span
        className={cn(
          'min-w-[12rem] flex-1 text-[15px]',
          next ? 'font-semibold' : 'font-medium',
          !open && 'text-muted-foreground',
          task.isSkipped && 'line-through'
        )}
      >
        <LaunchTaskLabel task={task} />
        {task.isCompleted ? (
          <span className="sr-only">
            {' '}
            <FormattedMessage id="onboarding.launch.done" defaultMessage="Done" />
          </span>
        ) : null}
      </span>
      {note ? <span className="text-sm text-muted-foreground">{note}</span> : null}
      {action}
      {open && !automatic && canSkip ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => onSkip(true)}
          aria-label={intl.formatMessage(
            { id: 'onboarding.launch.skipTask', defaultMessage: 'Skip {task}' },
            { task: intl.formatMessage(launchTaskMessage(task)) }
          )}
        >
          <FormattedMessage id="onboarding.launch.skip" defaultMessage="Skip" />
        </Button>
      ) : null}
      {task.isSkipped && canSkip ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => onSkip(false)}>
          <FormattedMessage id="onboarding.launch.undoSkip" defaultMessage="Undo skip" />
        </Button>
      ) : null}
    </li>
  )
}
