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
  'set-up-quinn': 'The AI agent answers customers instantly',
  'help-article': 'Customers answer their own questions',
  'add-status-service': 'Customers see what is running',
  'share-status-page': 'Customers subscribe for updates',
  'invite-team': 'Share the work with teammates',
  'customize-branding': 'Your portal looks like you',
  'connect-integration': 'Feedback flows into your tools',
  'first-win.feedback': 'Your first idea arrives',
  'first-win.support': 'A customer starts a conversation',
  'first-win.private': 'Your team starts sharing ideas',
  'first-win.helpCenter': 'Your first reader is helped',
  'first-win.status': 'Your first subscriber hears from you',
}

/** The step's outcome line, or null for a step without one. */
export function launchTaskOutcome(task: LaunchTask): MessageDescriptor | null {
  const key = `${task.id}${task.variant ? `.${task.variant}` : ''}`
  const defaultMessage = OUTCOMES[key]
  return defaultMessage ? { id: `onboarding.task.${key}.outcome`, defaultMessage } : null
}

/**
 * Why the step Home leads with matters, in a sentence or two. Only the steps
 * on a goal's path have one: Home never leads with anything else.
 */
const WHY: Record<string, string> = {
  'create-board': 'Give customers a place to post and vote on ideas.',
  'distribute-feedback':
    'Customers post and vote on ideas there. Paste it wherever they already talk to you.',
  'invite-team': 'Only teammates can see this board. Bring them in so ideas start flowing.',
  'connect-messenger':
    'Customers reach you from any page. Paste one snippet, or send it to whoever runs your site.',
  'help-article': 'Write the answer customers ask for most, then publish it.',
  'share-status-page':
    'Customers subscribe to hear about incidents. Link it from your footer or docs.',
  'first-win.feedback':
    'This ticks itself when someone outside your team posts or votes. Your own tests never count.',
  'first-win.private': 'This ticks itself when a teammate posts the first idea.',
  'first-win.support':
    'This ticks itself when someone outside your team writes in. Your own tests never count.',
  'first-win.helpCenter':
    'This ticks itself when someone outside your team marks an article helpful.',
  'first-win.status': 'This ticks itself when someone outside your team subscribes.',
}

/** The step's reason line for Home, or its outcome when it has none. */
export function launchTaskWhy(task: LaunchTask): MessageDescriptor | null {
  const key = `${task.id}${task.variant ? `.${task.variant}` : ''}`
  const defaultMessage = WHY[key]
  return defaultMessage
    ? { id: `onboarding.task.${key}.why`, defaultMessage }
    : launchTaskOutcome(task)
}
