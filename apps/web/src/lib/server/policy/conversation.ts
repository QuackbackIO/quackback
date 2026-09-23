/**
 * Conversation authorization.
 *
 * Mirrors the policy module contract (see policy/types.ts): pure functions
 * returning an explicit Decision so every deny carries a machine-readable
 * reason. Conversations are owned by a single visitor principal; the support
 * team sees and acts on all of them.
 */
import { allowDecision, denyDecision, type Actor, type Decision } from './types'
import { can, authorize } from './authorize'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { writePermissionFor } from '@/lib/shared/conversation/message-permissions'
import type { PrincipalId } from '@quackback/ids'
import type { ConversationStatus } from '@/lib/server/db'

export interface ConversationShape {
  visitorPrincipalId: PrincipalId
  status: ConversationStatus
}

/**
 * Who may read a conversation and its messages: the owning visitor, or any
 * team member. A non-owning visitor is denied (existence is hidden at the
 * access chokepoint, which throws NotFound rather than Forbidden).
 */
export function canViewConversation(actor: Actor, conv: ConversationShape): Decision {
  if (can(actor, PERMISSIONS.CONVERSATION_VIEW)) return allowDecision()
  if (actor.principalId && actor.principalId === conv.visitorPrincipalId) return allowDecision()
  return denyDecision('You do not have access to this conversation')
}

/**
 * Who may post a visitor-side message. The actor must own the conversation.
 * A closed conversation can still be replied to — sending reopens it. Service
 * principals (API keys/integrations) can never post as a visitor.
 */
export function canSendVisitorMessage(actor: Actor, conv: ConversationShape): Decision {
  if (!actor.principalId) return denyDecision('A session is required to send a message')
  if (actor.principalType === 'service')
    return denyDecision('Service principals cannot send messages')
  if (actor.principalId !== conv.visitorPrincipalId)
    return denyDecision('You do not have access to this conversation')
  return allowDecision()
}

/** Who may start a new conversation: any visitor (anonymous or identified) that
 * has a resolved principal. Service principals are excluded. */
export function canStartConversation(actor: Actor): Decision {
  if (!actor.principalId) return denyDecision('A session is required to start a conversation')
  if (actor.principalType === 'service')
    return denyDecision('Service principals cannot start a conversation')
  return allowDecision()
}

/** Who may reply as a support agent or manage conversations: team members only. */
export function canActAsAgent(actor: Actor): Decision {
  if (can(actor, PERMISSIONS.CONVERSATION_REPLY)) return allowDecision()
  return denyDecision('Only team members can act as a support agent')
}

interface AuthoredMessage {
  senderType: 'visitor' | 'agent' | 'system'
  // Null for author-less rows, which are never "your own message".
  authorPrincipalId: PrincipalId | null
  parent: 'conversation' | 'ticket'
  isInternal: boolean
}

/**
 * Who may delete a message, the way Slack does it: anyone may delete their own
 * agent message while they hold the permission that writes it; a moderator
 * (`conversation.manage`) may delete anyone's; and the visitor who owns a
 * conversation may delete their own visitor-side message in it. System rows
 * are refused by the caller before this check.
 */
export function canDeleteMessage(
  actor: Actor,
  message: AuthoredMessage,
  // The owning conversation, or null for a ticket-parented message.
  conversation: ConversationShape | null
): Decision {
  if (message.senderType === 'system') return denyDecision('System messages cannot be deleted')
  if (can(actor, PERMISSIONS.CONVERSATION_MANAGE)) return allowDecision()
  if (message.senderType === 'agent') return ownAgentMessage(actor, message, 'delete')
  if (
    conversation &&
    actor.principalId &&
    actor.principalType !== 'service' &&
    message.authorPrincipalId === actor.principalId &&
    conversation.visitorPrincipalId === actor.principalId
  ) {
    return allowDecision()
  }
  return denyDecision('You can only delete your own messages')
}

/**
 * Who may edit a message: only the author of an agent-side message, and only
 * while they hold the permission that writes that kind of message. Unlike
 * delete there is no moderator override: nobody rewrites someone else's words.
 */
export function canEditMessage(actor: Actor, message: AuthoredMessage): Decision {
  // A teammate can also write as a customer; that row stays the customer's.
  if (message.senderType !== 'agent') return denyDecision('Only agent messages can be edited')
  return ownAgentMessage(actor, message, 'edit')
}

/** The author acting on their own agent message, with the permission that writes it. */
function ownAgentMessage(
  actor: Actor,
  message: AuthoredMessage,
  verb: 'edit' | 'delete'
): Decision {
  if (!actor.principalId) return denyDecision(`A session is required to ${verb} a message`)
  if (actor.principalType === 'service')
    return denyDecision(`Service principals cannot ${verb} messages`)
  if (!message.authorPrincipalId || message.authorPrincipalId !== actor.principalId) {
    return denyDecision(`You can only ${verb} your own messages`)
  }
  return authorize(actor, writePermissionFor(message))
}
