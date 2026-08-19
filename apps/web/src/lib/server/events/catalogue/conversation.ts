/**
 * Conversation-family event declarations (WO-2). The workflow-triggerable subset
 * matches the current dispatchable trigger list (workflow-trigger-types.ts); the
 * two timer-driven "unresponsive" events are synthetic (system actor).
 */
import { decl } from './helpers'

const S = 'conversation'
const wf = { webhook: true, workflow: true } as const

export const conversationCreated = decl('conversation.created', 'conversation', wf, S)
export const conversationStatusChanged = decl('conversation.status_changed', 'conversation', wf, S)
export const conversationAssigned = decl('conversation.assigned', 'conversation', wf, S)
export const conversationPriorityChanged = decl(
  'conversation.priority_changed',
  'conversation',
  wf,
  S
)
export const conversationAttributeChanged = decl(
  'conversation.attribute_changed',
  'conversation',
  wf,
  S
)
export const conversationCsatSubmitted = decl('conversation.csat_submitted', 'conversation', wf, S)
export const conversationCsatCommentAdded = decl(
  'conversation.csat_comment_added',
  'conversation',
  { webhook: true },
  S
)
export const conversationNoteMentioned = decl(
  'conversation.note_mentioned',
  'conversation',
  { webhook: true, notification: 'mention' },
  S
)
export const conversationCustomerUnresponsive = decl(
  'conversation.customer_unresponsive',
  'conversation',
  wf,
  S
)
export const conversationTeammateUnresponsive = decl(
  'conversation.teammate_unresponsive',
  'conversation',
  wf,
  S
)
