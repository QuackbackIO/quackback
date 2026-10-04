/**
 * What each launch step gets the person, in four to six words, keyed like the
 * step's title. Home, the launch plan and the setup emails all say this, so a
 * step reads the same wherever it appears.
 */
import type { MessageDescriptor } from 'react-intl'
import type { LaunchTask } from './launch-checklist'

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
