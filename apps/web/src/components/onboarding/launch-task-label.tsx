import { FormattedMessage } from 'react-intl'
import type { LaunchTask } from '@/lib/shared/launch-checklist'

export function LaunchTaskLabel({ task }: { task: LaunchTask }) {
  return <FormattedMessage id={`onboarding.task.${task.id}`} defaultMessage={task.title} />
}
