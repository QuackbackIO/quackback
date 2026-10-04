import { useState, type ReactNode } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { CheckIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { CreateBoardDialog } from '@/components/admin/settings/boards/create-board-dialog'
import { useBaseUrl } from '@/lib/client/hooks/use-root-context'
import {
  LAUNCH_LIVE_STEP,
  launchPath,
  launchVisibilityHref,
  type LaunchPathGoal,
  type LaunchStatus,
  type LaunchTask,
} from '@/lib/shared/launch-checklist'
import { cn } from '@/lib/shared/utils'
import { LaunchStepAction } from './launch-step-action'
import { LaunchTaskLabel, LaunchTaskOutcome, launchTaskMessage } from './launch-task-label'
import { useProductTour } from './product-tour'
import { launchStatusQuery, useLaunchTaskResolution } from './use-launch-plan'

const isOpen = (task: LaunchTask) => !task.isCompleted && !task.isSkipped

/** The live page's public address, for the path's first step. */
function livePageHref(goal: LaunchPathGoal, status: LaunchStatus, baseUrl?: string) {
  if (!baseUrl) return undefined
  const path =
    goal === 'helpCenter'
      ? '/hc'
      : goal === 'status'
        ? '/status'
        : goal === 'support'
          ? '/'
          : (status.publicBoardPath ?? '/')
  return new URL(path, baseUrl).toString()
}

/**
 * The whole launch plan: the three-step path to a first win (the live page,
 * the goal step, the win), counted the same as Home and the sidebar, then
 * every other step under Later with one action and a Skip. Steps setup did
 * itself are left out.
 */
export function LaunchPlanPage({
  firstWinAction,
}: {
  /** An action for the automatic first-win step, such as sending a test message. */
  firstWinAction?: ReactNode
}) {
  const tour = useProductTour()
  const queryClient = useQueryClient()
  const baseUrl = useBaseUrl()
  const { data: status } = useSuspenseQuery(launchStatusQuery())
  const resolution = useLaunchTaskResolution()
  const [createBoardOpen, setCreateBoardOpen] = useState(false)
  const path = launchPath(status)
  const canSkip = status.permissions?.settingsManage !== false
  const percent = Math.round(((path.complete ? path.total : path.step - 1) / path.total) * 100)
  const liveHref = livePageHref(path.goal, status, baseUrl)
  const visibilityHref = canSkip ? launchVisibilityHref(path.goal, status) : null
  const renderRow = (task: LaunchTask, onPath: boolean) => (
    <LaunchPlanRow
      key={task.id}
      task={task}
      status={status}
      next={task.id === path.next?.id}
      canSkip={canSkip && !onPath}
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
        <div className="min-w-[min(16rem,100%)] flex-1 space-y-2.5">
          <h1 className="text-2xl font-semibold">
            <FormattedMessage id="onboarding.launch.name" defaultMessage="Launch plan" />
          </h1>
          <div className="flex items-center gap-3">
            <div
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={path.total}
              aria-valuenow={path.step}
              aria-labelledby="launch-plan-progress"
              className="h-1.5 w-56 max-w-full overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-foreground motion-safe:transition-[width]"
                style={{ width: `${percent}%` }}
              />
            </div>
            <span id="launch-plan-progress" className="text-sm text-muted-foreground">
              {path.complete ? (
                <FormattedMessage id="onboarding.launch.done" defaultMessage="Done" />
              ) : (
                <FormattedMessage
                  id="onboarding.launch.stepOf"
                  defaultMessage="Step {step} of {total}"
                  values={{ step: path.step, total: path.total }}
                />
              )}
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
            <FormattedMessage {...LAUNCH_LIVE_STEP[path.goal]} />
          </span>
          <span className="text-sm text-muted-foreground">
            <FormattedMessage id="onboarding.launch.done" defaultMessage="Done" />
          </span>
          {visibilityHref ? (
            <Button asChild size="sm" variant="ghost">
              <a href={visibilityHref}>
                <FormattedMessage
                  id="onboarding.launch.visibility"
                  defaultMessage="Who can see it"
                />
              </a>
            </Button>
          ) : null}
          {liveHref ? (
            <Button asChild size="sm" variant="outline">
              <a href={liveHref} target="_blank" rel="noopener noreferrer">
                <FormattedMessage id="onboarding.launch.review" defaultMessage="Review" />
              </a>
            </Button>
          ) : null}
        </li>
        {path.steps.map((task) => renderRow(task, true))}
      </ul>

      {path.later.length > 0 && (
        <section aria-labelledby="launch-group-later">
          <h2
            id="launch-group-later"
            className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            <FormattedMessage id="onboarding.launch.later" defaultMessage="Later" />
          </h2>
          <ul>{path.later.map((task) => renderRow(task, false))}</ul>
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
    <>
      {next ? (
        <span className="me-2 font-medium text-foreground">
          <FormattedMessage id="onboarding.home.next" defaultMessage="Next" />
        </span>
      ) : null}
      <FormattedMessage id="onboarding.launch.auto" defaultMessage="Marked done when it happens" />
    </>
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
