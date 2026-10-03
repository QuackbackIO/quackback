import { FormattedMessage, type MessageDescriptor } from 'react-intl'
import type { LaunchTask } from '@/lib/shared/launch-checklist'

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
