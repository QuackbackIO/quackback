import { FormattedMessage, type MessageDescriptor } from 'react-intl'
import type { LaunchTask } from '@/lib/shared/launch-checklist'
import { launchTaskOutcome } from '@/lib/shared/launch-outcomes'

export { launchTaskOutcome }

/**
 * The catalogue entry for a launch-plan step's title. A step whose wording
 * depends on the goal has its own entry per wording, so a translation never
 * replaces a goal-specific title with another goal's.
 */
export function launchTaskMessage(task: LaunchTask): MessageDescriptor {
  return {
    id: `onboarding.task.${task.id}${task.variant ? `.${task.variant}` : ''}`,
    defaultMessage: task.title,
  }
}

export function LaunchTaskLabel({ task }: { task: LaunchTask }) {
  return <FormattedMessage {...launchTaskMessage(task)} />
}

export function LaunchTaskOutcome({ task }: { task: LaunchTask }) {
  const message = launchTaskOutcome(task)
  return message ? <FormattedMessage {...message} /> : null
}
