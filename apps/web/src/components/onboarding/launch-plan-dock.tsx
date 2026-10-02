import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { FormattedMessage } from 'react-intl'
import { CheckIcon, RocketLaunchIcon } from '@heroicons/react/24/outline'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { adminQueries } from '@/lib/client/queries/admin'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { launchChecklistSummary } from '@/lib/shared/launch-checklist'
import { useProductTour } from './product-tour'
import { LaunchTaskLabel } from './launch-task-label'

export function LaunchPlanDock() {
  const [open, setOpen] = useState(false)
  const canView = usePermission(PERMISSIONS.MEMBER_VIEW)
  const tour = useProductTour()
  const { data } = useQuery({ ...adminQueries.onboardingStatus(), enabled: canView })
  if (!data) return null
  const summary = launchChecklistSummary(data)
  if (summary.resolved) return null
  const tasks = summary.tasks.filter(
    (task) => task.classification === 'prerequisite' && !task.isSkipped
  )
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-sm focus-visible:ring-muted-foreground"
        >
          <RocketLaunchIcon className="size-5" />
          <FormattedMessage id="onboarding.launch.title" defaultMessage="Launch plan" />
          <span className="ms-auto text-xs text-muted-foreground">
            {summary.doneCount}/{summary.denominator}
          </span>
        </Button>
      </PopoverTrigger>
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
