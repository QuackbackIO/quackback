import { FormattedMessage, type MessageDescriptor } from 'react-intl'
import type { LaunchTask } from '@/lib/shared/launch-checklist'

/** The catalogue entry for a launch-plan step's title. */
export function launchTaskMessage(task: LaunchTask): MessageDescriptor {
  return { id: `onboarding.task.${task.id}`, defaultMessage: task.title }
}

export function LaunchTaskLabel({ task }: { task: LaunchTask }) {
  return <FormattedMessage {...launchTaskMessage(task)} />
}
