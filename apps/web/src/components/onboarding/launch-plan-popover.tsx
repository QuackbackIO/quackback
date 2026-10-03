import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { FormattedMessage, useIntl } from 'react-intl'
import { CheckIcon } from '@heroicons/react/24/outline'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { launchChecklistSummary, type LaunchStatus } from '@/lib/shared/launch-checklist'
import { useProductTour } from './product-tour'
import { LaunchTaskLabel } from './launch-task-label'

export function LaunchPlanPopover({ status }: { status: LaunchStatus }) {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const tour = useProductTour()
  const summary = launchChecklistSummary(status)
  if (summary.resolved) return null
  const tasks = summary.tasks.filter(
    (task) => task.classification === 'prerequisite' && !task.isSkipped
  )
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Card className="mb-2 gap-0 rounded-xl py-0">
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            className="h-auto w-full flex-col items-stretch gap-2 rounded-xl px-3 py-3 text-xs focus-visible:ring-muted-foreground"
          >
            <span className="flex items-center justify-between gap-2">
              <span className="truncate font-semibold">
                <FormattedMessage id="onboarding.launch.title" defaultMessage="Launch plan" />
              </span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {summary.doneCount}/{summary.denominator}
              </span>
            </span>
            <Progress
              value={summary.doneCount}
              max={summary.denominator}
              aria-label={intl.formatMessage({
                id: 'onboarding.launch.title',
                defaultMessage: 'Launch plan',
              })}
              className="h-1 bg-muted [&>div]:bg-foreground [&>div]:motion-reduce:transition-none"
            />
          </Button>
        </PopoverTrigger>
      </Card>
      <PopoverContent side="right" align="end" className="w-80 space-y-3">
        <h2 className="text-sm font-semibold">
          <FormattedMessage id="onboarding.launch.title" defaultMessage="Launch plan" />
        </h2>
        <ol className="space-y-3">
          {tasks.map((task, i) => (
            <li key={task.id} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 w-4 shrink-0 text-muted-foreground" aria-hidden="true">
                {task.isCompleted ? <CheckIcon className="size-4" /> : i + 1}
              </span>
              {task.href && task.availability !== 'blocked' ? (
                <Link to={task.href} className="hover:underline">
                  <LaunchTaskLabel task={task} />
                </Link>
              ) : (
                <LaunchTaskLabel task={task} />
              )}
            </li>
          ))}
        </ol>
        <div className="flex items-center justify-between border-t pt-3">
          <Link to="/admin/getting-started" className="text-xs hover:underline">
            <FormattedMessage id="onboarding.launch.all" defaultMessage="See all" />
          </Link>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setOpen(false)
              tour?.start()
            }}
          >
            <FormattedMessage id="onboarding.tour.replay" defaultMessage="Replay the tour" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
