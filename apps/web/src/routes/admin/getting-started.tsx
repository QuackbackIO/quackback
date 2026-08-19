import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import {
  ArrowPathIcon,
  ArrowRightIcon,
  ArrowUturnLeftIcon,
  CheckIcon,
  ClockIcon,
  LockClosedIcon,
  MinusIcon,
  PencilSquareIcon,
  RocketLaunchIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline'
import { FormattedMessage, useIntl } from 'react-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PageHeader } from '@/components/shared/page-header'
import { UseCaseSelector } from '@/components/onboarding/use-case-selector'
import { adminQueries } from '@/lib/client/queries/admin'
import { setLaunchTaskResolutionFn } from '@/lib/server/functions/admin'
import { setActivationGoalFn } from '@/lib/server/functions/activation'
import {
  launchChecklistSummary,
  OUTCOME_HOME,
  OUTCOME_TAB_LABEL,
  type LaunchTask,
} from '@/lib/shared/launch-checklist'
import { normalizeOnboardingOutcome, type OnboardingOutcome } from '@/lib/shared/db-types'
import { cn } from '@/lib/shared/utils'

export const Route = createFileRoute('/admin/getting-started')({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(adminQueries.onboardingStatus())
  },
  component: GettingStartedPage,
})

function GettingStartedPage() {
  const intl = useIntl()
  const statusQuery = useSuspenseQuery({
    ...adminQueries.onboardingStatus(),
    refetchInterval: (query) => {
      const data = query.state.data
      return data && launchChecklistSummary(data).resolved ? false : 15_000
    },
  })
  const queryClient = useQueryClient()
  const status = statusQuery.data
  const outcome = normalizeOnboardingOutcome(status.useCase) ?? 'product_feedback'
  const summary = launchChecklistSummary(status, outcome)
  const [editingGoal, setEditingGoal] = useState(false)
  const [goalDraft, setGoalDraft] = useState<OnboardingOutcome>(outcome)
  const changeGoalButtonRef = useRef<HTMLButtonElement>(null)
  const canManage = status.permissions.settingsManage

  useEffect(() => setGoalDraft(outcome), [outcome])

  const resolutionMutation = useMutation({
    mutationFn: (data: { taskId: string; resolution: 'deferred' | 'dismissed' | null }) =>
      setLaunchTaskResolutionFn({ data: { ...data, outcome } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'onboarding'] }),
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : intl.formatMessage({
              id: 'activation.error.updatePlan',
              defaultMessage: 'We couldn’t update your launch plan. Try again.',
            })
      ),
  })

  const goalMutation = useMutation({
    mutationFn: (next: OnboardingOutcome) => setActivationGoalFn({ data: { outcome: next } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'onboarding'] })
      setEditingGoal(false)
      requestAnimationFrame(() => changeGoalButtonRef.current?.focus())
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : intl.formatMessage({
              id: 'activation.error.changeGoal',
              defaultMessage: 'We couldn’t change your goal. Try again.',
            })
      ),
  })

  const prerequisiteTasks = summary.tasks.filter((task) => task.classification === 'prerequisite')
  const polishTasks = summary.tasks.filter((task) => task.classification === 'polish')
  const firstWinTask = summary.tasks.find((task) => task.classification === 'first_win')
  const pageDescription = summary.firstWinComplete
    ? intl.formatMessage({
        id: 'activation.summary.firstWin',
        defaultMessage: 'You’re up and running',
      })
    : summary.blockedCount > 0 && summary.remaining === 0
      ? intl.formatMessage({
          id: 'activation.summary.attention',
          defaultMessage: 'Your workspace needs attention before you can launch',
        })
      : summary.allComplete
        ? intl.formatMessage({
            id: 'activation.summary.ready',
            defaultMessage: 'Everything is ready for your first result',
          })
        : intl.formatMessage(
            {
              id: 'activation.summary.remaining',
              defaultMessage:
                '{count, plural, one {# setup step to go} other {# setup steps to go}}',
            },
            { count: summary.remaining }
          )

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-3xl space-y-8 px-4 py-8 pb-12 sm:px-6 sm:pb-16">
        <PageHeader
          icon={RocketLaunchIcon}
          title={intl.formatMessage({
            id: 'activation.page.title',
            defaultMessage: 'Your launch plan',
          })}
          description={pageDescription}
          animate
        />
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {pageDescription}
        </p>

        <section aria-labelledby="activation-goal" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p
                id="activation-goal"
                className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                <FormattedMessage id="activation.goal.label" defaultMessage="Current goal" />
              </p>
              <h2 className="mt-1 text-lg font-semibold">
                <FormattedMessage
                  id={`activation.goal.${outcome}`}
                  defaultMessage={OUTCOME_TAB_LABEL[outcome]}
                />
              </h2>
            </div>
            <Button
              ref={changeGoalButtonRef}
              type="button"
              variant="outline"
              size="sm"
              className="h-11 sm:h-9"
              disabled={!canManage || status.goalManaged}
              onClick={() => setEditingGoal((value) => !value)}
            >
              <PencilSquareIcon className="h-4 w-4" />
              <FormattedMessage id="activation.goal.change" defaultMessage="Change goal" />
            </Button>
          </div>
          {status.goalManaged && (
            <p className="text-xs text-muted-foreground">
              <FormattedMessage
                id="activation.goal.managed"
                defaultMessage="Your workspace admin manages this goal."
              />
            </p>
          )}
          {editingGoal && (
            <div
              className="rounded-2xl border bg-card p-5"
              aria-label={intl.formatMessage({
                id: 'activation.goal.changeLabel',
                defaultMessage: 'Change workspace goal',
              })}
            >
              <UseCaseSelector
                value={goalDraft}
                onChange={(value) => setGoalDraft(value as OnboardingOutcome)}
              />
              <div className="mt-4 flex justify-end gap-2">
                <Button
                  variant="ghost"
                  className="h-11"
                  onClick={() => {
                    setEditingGoal(false)
                    requestAnimationFrame(() => changeGoalButtonRef.current?.focus())
                  }}
                >
                  <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
                </Button>
                <Button
                  className="h-11"
                  disabled={goalMutation.isPending || goalDraft === outcome}
                  onClick={() => goalMutation.mutate(goalDraft)}
                >
                  {goalMutation.isPending && (
                    <ArrowPathIcon className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                  )}
                  <FormattedMessage id="activation.goal.save" defaultMessage="Use this goal" />
                </Button>
              </div>
            </div>
          )}
        </section>

        <section aria-labelledby="readiness-heading" className="space-y-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 id="readiness-heading" className="text-base font-semibold">
                <FormattedMessage
                  id="activation.readiness.title"
                  defaultMessage="Set up the essentials"
                />
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                <FormattedMessage
                  id="activation.readiness.explanation"
                  defaultMessage="Complete these steps to start getting value from Quackback."
                />
              </p>
            </div>
            <span className="text-sm font-medium tabular-nums" aria-live="polite">
              {summary.doneCount} / {summary.denominator}
            </span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={intl.formatMessage({
              id: 'activation.progress.label',
              defaultMessage: 'Setup progress',
            })}
            aria-valuemin={0}
            aria-valuemax={summary.denominator}
            aria-valuenow={summary.doneCount}
          >
            <div
              className="h-full rounded-full bg-primary transition-transform duration-300 motion-reduce:transition-none"
              style={{
                transform: `scaleX(${summary.denominator ? summary.doneCount / summary.denominator : 1})`,
                transformOrigin: 'left',
              }}
            />
          </div>
          <TaskList
            tasks={prerequisiteTasks}
            outcome={outcome}
            canManage={canManage}
            pending={resolutionMutation.isPending}
            onResolution={(taskId, resolution) => resolutionMutation.mutate({ taskId, resolution })}
          />
        </section>

        {polishTasks.length > 0 && (
          <section aria-labelledby="polish-heading" className="space-y-3">
            <div>
              <h2 id="polish-heading" className="text-base font-semibold">
                <FormattedMessage id="activation.polish.title" defaultMessage="Make it yours" />
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                <FormattedMessage
                  id="activation.polish.description"
                  defaultMessage="Optional ways to tailor Quackback for your brand and workflow."
                />
              </p>
            </div>
            <TaskList
              tasks={polishTasks}
              outcome={outcome}
              canManage={canManage}
              pending={resolutionMutation.isPending}
              onResolution={(taskId, resolution) =>
                resolutionMutation.mutate({ taskId, resolution })
              }
            />
          </section>
        )}

        {firstWinTask && (
          <section
            aria-labelledby="first-win-heading"
            className={cn(
              'rounded-2xl border p-6',
              firstWinTask.isCompleted ? 'border-primary/30 bg-primary/5' : 'bg-card'
            )}
          >
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                {firstWinTask.isCompleted ? (
                  <SparklesIcon className="h-5 w-5" />
                ) : (
                  <ClockIcon className="h-5 w-5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <FormattedMessage
                    id={
                      firstWinTask.isCompleted
                        ? 'activation.firstWin.reached'
                        : 'activation.firstWin.next'
                    }
                    defaultMessage={
                      firstWinTask.isCompleted ? 'Milestone reached' : 'Next milestone'
                    }
                  />
                </p>
                <h2 id="first-win-heading" className="mt-1 font-semibold">
                  <FormattedMessage
                    id={`activation.task.${outcome}.${firstWinTask.id}.title`}
                    defaultMessage={firstWinTask.title}
                  />
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {firstWinTask.isCompleted ? (
                    status.firstWinAt ? (
                      <FormattedMessage
                        id="activation.firstWin.completedAt"
                        defaultMessage="Your first result arrived on {date}."
                        values={{
                          date: intl.formatDate(new Date(status.firstWinAt), {
                            dateStyle: 'medium',
                          }),
                        }}
                      />
                    ) : (
                      <FormattedMessage
                        id="activation.firstWin.completed"
                        defaultMessage="Your first result is here."
                      />
                    )
                  ) : (
                    <FormattedMessage
                      id={`activation.task.${outcome}.${firstWinTask.id}.description`}
                      defaultMessage={firstWinTask.description}
                    />
                  )}
                </p>
                <Button asChild variant="outline" size="sm" className="mt-4 h-11 sm:h-9">
                  <Link to={OUTCOME_HOME[outcome].href}>
                    <FormattedMessage
                      id={`activation.home.${outcome}`}
                      defaultMessage={OUTCOME_HOME[outcome].label}
                    />
                    <ArrowRightIcon className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </section>
        )}
      </div>
    </ScrollArea>
  )
}

function TaskList({
  tasks,
  outcome,
  canManage,
  pending,
  onResolution,
}: {
  tasks: LaunchTask[]
  outcome: OnboardingOutcome
  canManage: boolean
  pending: boolean
  onResolution: (taskId: string, resolution: 'deferred' | 'dismissed' | null) => void
}) {
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {tasks.map((task) => (
        <li key={task.id} className={cn('p-5', task.isDismissed && 'bg-muted/20')}>
          <div className="flex items-start gap-4">
            <TaskStateIcon task={task} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3
                  className={cn('text-sm font-medium', task.isDismissed && 'text-muted-foreground')}
                >
                  <FormattedMessage
                    id={`activation.task.${outcome}.${task.id}.title`}
                    defaultMessage={task.title}
                  />
                </h3>
                {task.isDeferred && (
                  <Badge variant="secondary">
                    <FormattedMessage id="activation.state.later" defaultMessage="For later" />
                  </Badge>
                )}
                {task.isDismissed && (
                  <Badge variant="secondary">
                    <FormattedMessage id="activation.state.skipped" defaultMessage="Skipped" />
                  </Badge>
                )}
                {task.availability === 'blocked' && (
                  <Badge variant="outline">
                    <FormattedMessage
                      id="activation.state.attention"
                      defaultMessage="Needs attention"
                    />
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                <FormattedMessage
                  id={`activation.task.${outcome}.${task.id}.${task.blockedReason ? 'blocked' : 'description'}`}
                  defaultMessage={task.blockedReason ?? task.description}
                />
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {!task.isDismissed && task.href && (
                  <Button
                    asChild
                    size="sm"
                    variant={task.isCompleted ? 'outline' : 'default'}
                    className="h-11 sm:h-9"
                  >
                    <Link to={task.href}>
                      <FormattedMessage
                        id={`activation.task.${outcome}.${task.id}.${task.isCompleted ? 'completedAction' : 'action'}`}
                        defaultMessage={task.isCompleted ? task.completedLabel : task.actionLabel}
                      />
                      <ArrowRightIcon className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                )}
                {!task.isCompleted && canManage && task.classification === 'prerequisite' && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-11 sm:h-9"
                    disabled={pending}
                    onClick={() => onResolution(task.id, task.isDeferred ? null : 'deferred')}
                  >
                    {task.isDeferred ? (
                      <ArrowUturnLeftIcon className="h-4 w-4" />
                    ) : (
                      <ClockIcon className="h-4 w-4" />
                    )}
                    <FormattedMessage
                      id={
                        task.isDeferred ? 'activation.action.moveUp' : 'activation.action.doLater'
                      }
                      defaultMessage={task.isDeferred ? 'Move up' : 'Do later'}
                    />
                  </Button>
                )}
                {!task.isCompleted && canManage && task.classification === 'polish' && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-11 sm:h-9"
                    disabled={pending}
                    onClick={() => onResolution(task.id, task.isDismissed ? null : 'dismissed')}
                  >
                    {task.isDismissed ? (
                      <ArrowUturnLeftIcon className="h-4 w-4" />
                    ) : (
                      <MinusIcon className="h-4 w-4" />
                    )}
                    <FormattedMessage
                      id={task.isDismissed ? 'activation.action.addBack' : 'activation.action.skip'}
                      defaultMessage={task.isDismissed ? 'Add back' : 'Skip'}
                    />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

function TaskStateIcon({ task }: { task: LaunchTask }) {
  const icon = task.isCompleted ? (
    <CheckIcon className="h-4 w-4" />
  ) : task.availability === 'blocked' ? (
    <LockClosedIcon className="h-4 w-4" />
  ) : task.isDeferred ? (
    <ClockIcon className="h-4 w-4" />
  ) : task.isDismissed ? (
    <MinusIcon className="h-4 w-4" />
  ) : (
    <span className="h-2 w-2 rounded-full bg-current" />
  )
  return (
    <div
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
        task.isCompleted ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
      )}
      aria-hidden="true"
    >
      {icon}
    </div>
  )
}
