import { CheckIcon } from '@heroicons/react/24/solid'
import { FormattedMessage, useIntl } from 'react-intl'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
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
}: {
  status: LaunchStatus
  pending: boolean
  onSkip: (taskId: string) => void
  onCreateBoard: () => void
  full?: boolean
}) {
  const intl = useIntl()
  const summary = launchChecklistSummary(status)
  if (summary.resolved && !full) return null
  const tasks = full
    ? summary.tasks
    : summary.tasks
        .filter(
          (task) => task.classification !== 'first_win' && !task.isCompleted && !task.isSkipped
        )
        .slice(0, 2)
  return (
    <section
      aria-labelledby="getting-started-title"
      className="space-y-3 [--ring:var(--muted-foreground)]"
    >
      <div className="flex items-center justify-between">
        <h2 id="getting-started-title" className={full ? 'sr-only' : 'text-sm font-semibold'}>
          <FormattedMessage id="onboarding.launch.title" defaultMessage="Your launch plan" />
        </h2>
        {!full && (
          <Link
            to="/admin/getting-started"
            className="text-xs text-muted-foreground hover:underline"
          >
            <FormattedMessage id="onboarding.launch.all" defaultMessage="See all" />
          </Link>
        )}
      </div>
      <ol className="grid gap-3 sm:grid-cols-3">
        {!full && (
          <li className="flex min-h-36 flex-col justify-between rounded-xl border bg-card p-4">
            <CheckIcon className="size-5 text-muted-foreground" aria-hidden="true" />
            <h3 className="text-sm font-medium">
              <FormattedMessage id="onboarding.launch.live" defaultMessage="Portal is live" />
            </h3>
          </li>
        )}
        {tasks.map((task) => {
          const copy =
            task.id === 'distribute-feedback' ? copyBoardLinkAction(summary.outcome, status) : null
          return (
            <li
              key={task.id}
              className="flex min-h-36 flex-col justify-between gap-3 rounded-xl border bg-card p-4"
            >
              <h3 className="text-sm font-medium">
                <LaunchTaskLabel task={task} />
              </h3>
              {task.availability === 'blocked' && (
                <p className="text-xs text-muted-foreground">
                  <FormattedMessage
                    id="onboarding.launch.adminNeeded"
                    defaultMessage="Ask a workspace admin to complete this step."
                  />
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
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
                  <ActivationActionButton action={copy} surface="launch_plan" className="h-8" />
                ) : task.id === 'create-board' ? (
                  <Button
                    size="sm"
                    disabled={pending || task.availability === 'blocked'}
                    onClick={onCreateBoard}
                  >
                    <FormattedMessage id="onboarding.launch.start" defaultMessage="Start" />
                  </Button>
                ) : task.href && task.availability !== 'blocked' ? (
                  <Button asChild size="sm">
                    <Link to={task.href}>
                      <FormattedMessage id="onboarding.launch.start" defaultMessage="Start" />
                    </Link>
                  </Button>
                ) : null}
                {!task.isCompleted && task.classification !== 'first_win' && (
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
    </section>
  )
}
