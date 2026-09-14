import { CheckIcon } from '@heroicons/react/24/solid'
import { FormattedMessage } from 'react-intl'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { ActivationActionButton } from '@/components/admin/activation-action-button'
import { copyBoardLinkAction } from '@/lib/shared/activation-action'
import {
  launchChecklistSummary,
  type LaunchStatus,
  type LaunchTask,
} from '@/lib/shared/launch-checklist'
import { cn } from '@/lib/shared/utils'

export function GettingStartedCard({
  status,
  pending,
  onSkip,
  onCreateBoard,
}: {
  status: LaunchStatus
  pending: boolean
  onSkip: (taskId: string) => void
  onCreateBoard: () => void
}) {
  const summary = launchChecklistSummary(status)
  if (summary.resolved) return null

  const essentials = summary.tasks.filter(
    (task) => task.classification === 'prerequisite' && !task.isSkipped
  )
  const currentTask = essentials.find((task) => !task.isCompleted)
  const percent = summary.percent

  return (
    <section
      aria-labelledby="getting-started-title"
      className="rounded-xl border border-primary/35 bg-card px-5 pb-2 pt-5"
    >
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 id="getting-started-title" className="text-[15px] font-semibold">
          <FormattedMessage id="activation.card.title" defaultMessage="Getting started" />
        </h2>
        <p className="text-[13px] font-medium text-muted-foreground">
          <FormattedMessage
            id="activation.card.percent"
            defaultMessage="{percent}% completed"
            values={{ percent }}
          />
        </p>
      </div>
      <div
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="mb-2 h-1 overflow-hidden rounded-full bg-muted"
      >
        <span className="block h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <ol>
        {essentials.map((task, index) => {
          const kind = task.isCompleted ? 'done' : currentTask?.id === task.id ? 'now' : 'later'
          return (
            <GettingStartedRow
              key={task.id}
              task={task}
              index={index}
              kind={kind}
              status={status}
              outcome={summary.outcome}
              pending={pending}
              onSkip={onSkip}
              onCreateBoard={onCreateBoard}
            />
          )
        })}
      </ol>
    </section>
  )
}

function GettingStartedRow({
  task,
  index,
  kind,
  status,
  outcome,
  pending,
  onSkip,
  onCreateBoard,
}: {
  task: LaunchTask
  index: number
  kind: 'done' | 'now' | 'later'
  status: LaunchStatus
  outcome: ReturnType<typeof launchChecklistSummary>['outcome']
  pending: boolean
  onSkip: (taskId: string) => void
  onCreateBoard: () => void
}) {
  const copyAction =
    kind === 'now' && task.id === 'distribute-feedback'
      ? copyBoardLinkAction(outcome, status)
      : null

  return (
    <li
      className={cn(
        'flex items-start gap-3 border-t border-border/70 py-3.5 first:border-t-0',
        kind === 'now' && 'items-center'
      )}
    >
      <StepMark kind={kind} index={index} />
      <div className="min-w-0 flex-1">
        <h3
          className={cn(
            'text-sm font-medium',
            kind !== 'now' && 'font-normal text-muted-foreground'
          )}
        >
          {task.title}
        </h3>
        {kind === 'now' && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {task.blockedReason ?? task.description}
          </p>
        )}
      </div>
      {kind === 'now' && (
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {!task.isCompleted && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-3 text-[13px] text-muted-foreground"
              disabled={pending}
              onClick={() => onSkip(task.id)}
            >
              <FormattedMessage id="activation.action.skip" defaultMessage="Skip" />
            </Button>
          )}
          {copyAction ? (
            <ActivationActionButton
              action={copyAction}
              surface="launch_plan"
              className="h-8 px-3.5"
            />
          ) : task.id === 'create-board' ? (
            <Button
              type="button"
              size="sm"
              className="h-8 rounded-full px-3.5 text-[13px]"
              disabled={pending || task.availability === 'blocked'}
              onClick={onCreateBoard}
            >
              <FormattedMessage id="activation.action.start" defaultMessage="Start" />
            </Button>
          ) : task.href && task.availability !== 'blocked' ? (
            <Button asChild size="sm" className="h-8 rounded-full px-3.5 text-[13px]">
              <Link to={task.href}>
                <FormattedMessage id="activation.action.start" defaultMessage="Start" />
              </Link>
            </Button>
          ) : null}
        </div>
      )}
    </li>
  )
}

function StepMark({ kind, index }: { kind: 'done' | 'now' | 'later'; index: number }) {
  return (
    <span
      className={cn(
        'mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-[1.5px] text-[11px] font-semibold',
        kind === 'done' && 'border-primary bg-primary text-primary-foreground',
        kind === 'now' && 'border-primary text-primary shadow-[0_0_0_3px] shadow-primary/20',
        kind === 'later' && 'border-border bg-background text-muted-foreground'
      )}
      aria-hidden="true"
    >
      {kind === 'done' ? <CheckIcon className="h-3 w-3" /> : index + 1}
    </span>
  )
}
