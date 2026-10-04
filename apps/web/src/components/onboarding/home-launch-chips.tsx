import { FormattedMessage } from 'react-intl'
import { useQuery } from '@tanstack/react-query'
import {
  isLaunchPlanActive,
  launchPath,
  type LaunchStatus,
  type LaunchTask,
} from '@/lib/shared/launch-checklist'
import { LaunchTaskLabel } from './launch-task-label'
import { LaunchTaskLink } from './launch-task-link'
import { TryMessengerButton } from './try-messenger-button'
import { launchStatusQuery } from './use-launch-plan'

const CHIP =
  'inline-flex h-8 max-w-full items-center rounded-full border bg-card px-3 text-[13px] shadow-raise transition-[box-shadow,transform] duration-200 ease-out hover:-translate-y-px hover:shadow-raise-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-muted-foreground'

export type LaunchChip = { kind: 'task'; task: LaunchTask } | { kind: 'try-messenger' }

/**
 * Home's chips: the open launch steps beside the path, at most three, each
 * opening the sheet or page that does it. Trying Messenger as a customer sits
 * next to putting it on the site.
 */
export function launchChips(status: LaunchStatus): LaunchChip[] {
  if (!isLaunchPlanActive(status)) return []
  const chips: LaunchChip[] = []
  for (const task of launchPath(status).later) {
    if (task.isCompleted || task.isSkipped || task.availability === 'blocked') continue
    if (!task.sheet && !task.href) continue
    chips.push({ kind: 'task', task })
    if (task.id === 'connect-messenger') chips.push({ kind: 'try-messenger' })
  }
  return chips.slice(0, 3)
}

export function HomeLaunchChips() {
  const { data } = useQuery(launchStatusQuery())
  if (!data || data.inLaunchWindow === false) return null
  const chips = launchChips(data)
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2 [--ring:var(--muted-foreground)]">
      {chips.map((chip) =>
        chip.kind === 'try-messenger' ? (
          <TryMessengerButton
            key="try-messenger"
            start="message"
            variant="outline"
            size="sm"
            className="h-8 rounded-full bg-card text-[13px] font-normal shadow-raise"
          >
            <FormattedMessage
              id="onboarding.chip.tryMessenger"
              defaultMessage="Try Messenger as a customer"
            />
          </TryMessengerButton>
        ) : (
          <LaunchTaskLink key={chip.task.id} task={chip.task} className={CHIP}>
            <LaunchTaskLabel task={chip.task} />
          </LaunchTaskLink>
        )
      )}
    </div>
  )
}
