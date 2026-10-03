import { CheckIcon } from '@heroicons/react/24/solid'
import { FormattedMessage, useIntl } from 'react-intl'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/shared/utils'
import { ActivationActionButton } from '@/components/admin/activation-action-button'
import { LaunchTaskLabel } from '@/components/onboarding/launch-task-label'
import { copyBoardLinkAction } from '@/lib/shared/activation-action'
import { launchChecklistSummary, type LaunchStatus } from '@/lib/shared/launch-checklist'

export function GettingStartedCard({
  status,
  pending,
  onSkip,
  onCreateBoard,
  full = false,
  portalUrl,
  compact = false,
}: {
  status: LaunchStatus
  pending: boolean
  onSkip: (taskId: string) => void
  onCreateBoard: () => void
  full?: boolean
  portalUrl?: string
  compact?: boolean
}) {
  const intl = useIntl()
  const summary = launchChecklistSummary(status)
  const rows = compact && !full
  if (summary.resolved && !full) return null
  const tasks = full
    ? summary.tasks
    : summary.tasks
        .filter(
          (task) => task.classification !== 'first_win' && !task.isCompleted && !task.isSkipped
        )
        .slice(0, 2)
  return (
    <Card
      role="region"
      aria-labelledby="getting-started-title"
      className={
        full || rows
          ? 'gap-3 border-0 bg-transparent py-0 [--ring:var(--muted-foreground)]'
          : 'gap-4 rounded-xl p-4 [--ring:var(--muted-foreground)]'
      }
    >
      <div className="flex items-center justify-between">
        <h2 id="getting-started-title" className={full ? 'sr-only' : 'text-sm font-semibold'}>
          <FormattedMessage id="onboarding.launch.title" defaultMessage="Your launch plan" />
        </h2>
        {rows && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {summary.doneCount}/{summary.denominator}
          </span>
        )}
        {!full && !rows && (
          <Link
            to="/admin/getting-started"
            className="text-xs text-muted-foreground hover:underline"
          >
            <FormattedMessage id="onboarding.launch.all" defaultMessage="See all" />
          </Link>
        )}
      </div>
      <ol className={rows ? 'divide-y divide-border' : 'grid gap-3 sm:grid-cols-3'}>
        {!full && (
          <li
            className={
              rows
                ? 'flex flex-wrap items-center gap-2 py-3'
                : 'flex flex-col gap-4 rounded-xl border bg-muted/30 p-3'
            }
          >
            <div className="flex items-center gap-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
                <CheckIcon className="size-3.5" aria-hidden="true" />
              </span>
              <h3
                className={cn(
                  'text-sm text-muted-foreground',
                  rows ? 'font-normal line-through' : 'font-medium'
                )}
              >
                <FormattedMessage id="onboarding.launch.live" defaultMessage="Portal is live" />
              </h3>
            </div>
            {!rows && portalUrl && (
              <div className="overflow-hidden rounded-lg border bg-background">
                <div className="h-5 bg-primary" aria-hidden="true" />
                <a
                  href={portalUrl}
                  className="block truncate px-3 py-4 text-xs text-muted-foreground hover:underline"
                >
                  {new URL(portalUrl).host}
                </a>
              </div>
            )}
          </li>
        )}
        {tasks.map((task, index) => {
          const copy =
            task.id === 'distribute-feedback' ? copyBoardLinkAction(summary.outcome, status) : null
          return (
            <li
              key={task.id}
              className={
                rows
                  ? 'flex flex-wrap items-center gap-x-4 gap-y-2 py-3'
                  : 'flex flex-col gap-4 rounded-xl border bg-background p-3'
              }
            >
              <div className={cn('flex items-center gap-2', rows && 'min-w-0 flex-1')}>
                <span
                  className="flex size-5 shrink-0 items-center justify-center rounded-full border text-xs text-muted-foreground"
                  aria-hidden="true"
                >
                  {full ? index + 1 : index + 2}
                </span>
                <h3
                  className={cn(
                    'min-w-0 text-sm',
                    rows && index > 0 ? 'font-normal text-muted-foreground' : 'font-medium'
                  )}
                >
                  <LaunchTaskLabel task={task} />
                </h3>
              </div>
              {!full && !rows && copy?.kind === 'copy' && portalUrl && (
                <code className="truncate rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                  {new URL(copy.payload.path, portalUrl).href.replace(/^https?:\/\//, '')}
                </code>
              )}
              {task.availability === 'blocked' && (
                <p className="text-xs text-muted-foreground">
                  <FormattedMessage
                    id="onboarding.launch.adminNeeded"
                    defaultMessage="Ask a workspace admin to complete this step."
                  />
                </p>
              )}
              <div className={cn('flex flex-wrap items-center gap-2', !rows && 'mt-auto')}>
                {task.isCompleted ? (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <CheckIcon className="size-4" />
                    <FormattedMessage id="onboarding.launch.done" defaultMessage="Done" />
                  </span>
                ) : task.isSkipped ? (
                  <span className="text-xs text-muted-foreground">
                    <FormattedMessage id="onboarding.launch.skipped" defaultMessage="Skipped" />
                  </span>
                ) : copy ? (
                  <ActivationActionButton
                    action={copy}
                    surface="launch_plan"
                    variant={rows ? 'ghost' : 'default'}
                    className={
                      rows
                        ? 'h-auto px-0 py-0 text-xs underline underline-offset-4 [&_svg]:hidden'
                        : 'h-8'
                    }
                  />
                ) : task.id === 'create-board' ? (
                  <Button
                    size="sm"
                    variant={rows ? 'ghost' : 'default'}
                    className={
                      rows ? 'h-auto px-0 py-0 text-xs underline underline-offset-4' : undefined
                    }
                    disabled={pending || task.availability === 'blocked'}
                    onClick={onCreateBoard}
                  >
                    <FormattedMessage id="onboarding.launch.start" defaultMessage="Start" />
                  </Button>
                ) : task.href && task.availability !== 'blocked' ? (
                  <Button
                    asChild
                    size="sm"
                    variant={rows ? 'ghost' : 'default'}
                    className={
                      rows ? 'h-auto px-0 py-0 text-xs underline underline-offset-4' : undefined
                    }
                  >
                    <Link to={task.href}>
                      <FormattedMessage id="onboarding.launch.start" defaultMessage="Start" />
                    </Link>
                  </Button>
                ) : null}
                {!rows && !task.isCompleted && task.classification !== 'first_win' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => onSkip(task.id)}
                    aria-label={intl.formatMessage(
                      { id: 'onboarding.launch.skipTask', defaultMessage: 'Skip {task}' },
                      {
                        task: intl.formatMessage({
                          id: `onboarding.task.${task.id}`,
                          defaultMessage: task.title,
                        }),
                      }
                    )}
                  >
                    <FormattedMessage id="onboarding.tour.skip" defaultMessage="Skip" />
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      {rows && (
        <Link
          to="/admin/getting-started"
          className="w-fit text-xs text-muted-foreground hover:underline"
        >
          <FormattedMessage id="onboarding.launch.all" defaultMessage="See all" />
        </Link>
      )}
    </Card>
  )
}
