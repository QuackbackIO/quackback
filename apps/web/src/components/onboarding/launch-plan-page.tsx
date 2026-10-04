import { useState, type ReactNode } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { CheckIcon, ChevronRightIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { CreateBoardDialog } from '@/components/admin/settings/boards/create-board-dialog'
import {
  launchPlanGroups,
  launchPlanProgress,
  type LaunchPlanGroupId,
  type LaunchStatus,
  type LaunchTask,
} from '@/lib/shared/launch-checklist'
import { cn } from '@/lib/shared/utils'
import { LaunchStepAction } from './launch-step-action'
import { LaunchTaskLabel, LaunchTaskOutcome, launchTaskMessage } from './launch-task-label'
import { useProductTour } from './product-tour'
import { launchStatusQuery, useLaunchTaskResolution } from './use-launch-plan'

const GROUP_NAME: Record<
  Exclude<LaunchPlanGroupId, 'polish'>,
  { id: string; defaultMessage: string }
> = {
  product_feedback: { id: 'onboarding.launch.group.feedback', defaultMessage: 'Feedback' },
  customer_support: { id: 'onboarding.launch.group.support', defaultMessage: 'Support' },
  help_center: { id: 'onboarding.launch.group.helpCenter', defaultMessage: 'Help Center' },
  status_page: { id: 'onboarding.launch.group.status', defaultMessage: 'Status' },
}

const isOpen = (task: LaunchTask) => !task.isCompleted && !task.isSkipped

/**
 * The whole launch plan: the live portal, then each goal's path, one row per
 * step with its outcome and one action, and the polish under Later. Steps
 * setup did itself read Ready; automatic steps say they complete themselves.
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
  const [laterOpen, setLaterOpen] = useState(false)
  const groups = launchPlanGroups(status)
  const goalGroups = groups.flatMap((group) =>
    group.id === 'polish' ? [] : [{ id: group.id, tasks: group.tasks }]
  )
  const later = groups.find((group) => group.id === 'polish')?.tasks ?? []
  const progress = launchPlanProgress(status)
  const canSkip = status.permissions?.settingsManage !== false
  const nextTaskId = groups
    .flatMap((group) => group.tasks)
    .find(
      (task) =>
        isOpen(task) && task.availability === 'available' && task.classification !== 'first_win'
    )?.id
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  const renderRow = (task: LaunchTask) => (
    <LaunchPlanRow
      key={task.id}
      task={task}
      status={status}
      next={task.id === nextTaskId}
      canSkip={canSkip}
      pending={resolution.isPending}
      firstWinAction={firstWinAction}
      onSkip={(resolved) =>
        resolution.mutate({ taskId: task.id, resolution: resolved ? 'dismissed' : null })
      }
      onCreateBoard={() => setCreateBoardOpen(true)}
    />
  )

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

      <ul>
        <li className="flex min-h-14 items-center gap-3 border-b border-border/60 py-1.5">
          <StepMark done />
          <span className="min-w-0 flex-1 text-[15px] font-medium text-muted-foreground">
            <FormattedMessage id="onboarding.launch.live" defaultMessage="Portal is live" />
          </span>
          <span className="text-sm text-muted-foreground">
            <FormattedMessage id="onboarding.launch.done" defaultMessage="Done" />
          </span>
        </li>
      </ul>

      {goalGroups.map((group) => (
        <section key={group.id} aria-labelledby={`launch-group-${group.id}`}>
          <h2
            id={`launch-group-${group.id}`}
            className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {intl.formatMessage(GROUP_NAME[group.id])}
          </h2>
          <ul>{group.tasks.map(renderRow)}</ul>
        </section>
      ))}

      {later.length > 0 && (
        <section>
          <button
            type="button"
            aria-expanded={laterOpen}
            aria-controls="launch-group-later"
            onClick={() => setLaterOpen((open) => !open)}
            className="mb-1 flex items-center gap-1.5 rounded text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-muted-foreground"
          >
            <ChevronRightIcon
              aria-hidden="true"
              className={cn('size-3.5 motion-safe:transition-transform', laterOpen && 'rotate-90')}
            />
            <FormattedMessage id="onboarding.launch.later" defaultMessage="Later" />
          </button>
          {laterOpen && <ul id="launch-group-later">{later.map(renderRow)}</ul>}
        </section>
      )}

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

function StepMark({ done = false, next = false }: { done?: boolean; next?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px]',
        done
          ? 'border-foreground bg-foreground text-background'
          : next
            ? 'border-foreground'
            : 'border-border'
      )}
    >
      {done ? <CheckIcon className="size-3" /> : null}
    </span>
  )
}

function LaunchPlanRow({
  task,
  status,
  next,
  canSkip,
  pending,
  firstWinAction,
  onSkip,
  onCreateBoard,
}: {
  task: LaunchTask
  status: LaunchStatus
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

  if (task.isReady) {
    return (
      <li className="flex min-h-14 items-center gap-3 border-b border-border/60 py-1.5 text-muted-foreground">
        <StepMark />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium">
            <LaunchTaskLabel task={task} />
          </span>
          <span className="block text-xs">
            <LaunchTaskOutcome task={task} />
          </span>
        </span>
        <span className="text-sm">
          <FormattedMessage id="onboarding.launch.ready" defaultMessage="Ready" />
        </span>
      </li>
    )
  }

  const note = task.isSkipped ? (
    <FormattedMessage id="onboarding.launch.skipped" defaultMessage="Skipped" />
  ) : task.isCompleted ? (
    <FormattedMessage id="onboarding.launch.done" defaultMessage="Done" />
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
      <StepMark done={task.isCompleted} next={next} />
      <span className={cn('min-w-[12rem] flex-1', !open && 'text-muted-foreground')}>
        <span className={cn('block text-[15px]', next ? 'font-semibold' : 'font-medium')}>
          <LaunchTaskLabel task={task} />
        </span>
        <span className="block text-xs text-muted-foreground">
          <LaunchTaskOutcome task={task} />
        </span>
      </span>
      {note ? <span className="text-sm text-muted-foreground">{note}</span> : null}
      <LaunchStepAction
        task={task}
        status={status}
        primary={next}
        pending={pending}
        firstWinAction={firstWinAction}
        onCreateBoard={onCreateBoard}
      />
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
