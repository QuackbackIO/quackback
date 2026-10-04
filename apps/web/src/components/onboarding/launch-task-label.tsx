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

/** Four to six words on what each step gets the person, keyed like the title. */
const OUTCOMES: Record<string, string> = {
  'create-board': 'Where customers share ideas',
  'create-board.private': 'Where your team shares ideas',
  'distribute-feedback': 'Customers find your board',
  'publish-changelog': 'Customers see what shipped',
  'connect-messenger': 'Customers reach you from your site',
  'set-up-quinn': 'Quinn answers customers instantly',
  'help-article': 'Customers answer their own questions',
  'add-status-service': 'Customers see what is running',
  'invite-team': 'Share the work with teammates',
  'customize-branding': 'Your portal looks like you',
  'connect-integration': 'Feedback flows into your tools',
  'first-win.feedback': 'Your first idea arrives',
  'first-win.support': 'A customer starts a conversation',
  'first-win.helpCenter': 'Your first answer goes live',
  'first-win.status': 'Customers can check your status',
}

/** The step's outcome line, or null for a step without one. */
export function launchTaskOutcome(task: LaunchTask): MessageDescriptor | null {
  const key = `${task.id}${task.variant ? `.${task.variant}` : ''}`
  const defaultMessage = OUTCOMES[key]
  return defaultMessage ? { id: `onboarding.task.${key}.outcome`, defaultMessage } : null
}

export function LaunchTaskOutcome({ task }: { task: LaunchTask }) {
  const message = launchTaskOutcome(task)
  return message ? <FormattedMessage {...message} /> : null
}
