import type { ReactNode } from 'react'
import { CheckIcon } from '@heroicons/react/24/solid'
import { FormattedMessage, useIntl } from 'react-intl'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ActivationActionButton } from '@/components/admin/activation-action-button'
import { LaunchTaskLabel, launchTaskMessage } from '@/components/onboarding/launch-task-label'
import { copyBoardLinkAction } from '@/lib/shared/activation-action'
import { launchChecklistSummary, type LaunchStatus } from '@/lib/shared/launch-checklist'

export function GettingStartedCard({
  status,
  pending,
  onSkip,
  onCreateBoard,
  portalUrl,
  brandingNotice,
}: {
  status: LaunchStatus
  pending: boolean
  onSkip: (taskId: string) => void
  onCreateBoard: () => void
  portalUrl?: string
  /** Logo and color found on the workspace's website, shown in the portal tile. */
  brandingNotice?: ReactNode
}) {
  const intl = useIntl()
  const summary = launchChecklistSummary(status)
  if (summary.resolved) return null
  const tasks = summary.tasks
    .filter((task) => task.classification !== 'first_win' && !task.isCompleted && !task.isSkipped)
    .slice(0, 2)
  return (
    <Card
      role="region"
      aria-labelledby="getting-started-title"
      className="gap-4 rounded-xl p-4 [--ring:var(--muted-foreground)]"
    >
      <div className="flex items-center justify-between">
        <h2 id="getting-started-title" className="text-sm font-semibold">
          <FormattedMessage id="onboarding.launch.title" defaultMessage="Your launch plan" />
        </h2>
        <Link to="/admin/getting-started" className="text-xs text-muted-foreground hover:underline">
          <FormattedMessage id="onboarding.launch.all" defaultMessage="See all" />
        </Link>
      </div>
      <ol className="grid gap-3 sm:grid-cols-3">
        <li className="flex flex-col gap-4 rounded-xl border bg-muted/30 p-3">
          <div className="flex items-center gap-2">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
              <CheckIcon className="size-3.5" aria-hidden="true" />
            </span>
            <h3 className="text-sm font-medium text-muted-foreground">
              <FormattedMessage id="onboarding.launch.live" defaultMessage="Portal is live" />
            </h3>
          </div>
          {portalUrl && (
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
          {brandingNotice}
        </li>
        {tasks.map((task, index) => {
          const copy =
            task.id === 'distribute-feedback' ? copyBoardLinkAction(summary.outcome, status) : null
          return (
            <li key={task.id} className="flex flex-col gap-4 rounded-xl border bg-background p-3">
              <div className="flex items-center gap-2">
                <span
                  className="flex size-5 shrink-0 items-center justify-center rounded-full border text-xs text-muted-foreground"
                  aria-hidden="true"
                >
                  {index + 2}
                </span>
                <h3 className="text-sm font-medium">
                  <LaunchTaskLabel task={task} />
                </h3>
              </div>
              {copy?.kind === 'copy' && portalUrl && (
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
              <div className="mt-auto flex flex-wrap items-center gap-2">
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
                      { task: intl.formatMessage(launchTaskMessage(task)) }
                    )}
                  >
                    <FormattedMessage id="onboarding.launch.skip" defaultMessage="Skip" />
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}
