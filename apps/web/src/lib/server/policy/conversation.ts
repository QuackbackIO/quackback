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
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
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

/**
 * Who may delete a message: a team member (any message), or the visitor who
 * authored it (their own visitor-side message in their own conversation).
 */
export function canDeleteMessage(
  actor: Actor,
  // authorPrincipalId is null for author-less rows; a null author can never be
  // "your own message", so a non-team actor is correctly denied.
  message: { senderType: 'visitor' | 'agent'; authorPrincipalId: PrincipalId | null },
  conversation: ConversationShape
): Decision {
  if (can(actor, PERMISSIONS.CONVERSATION_MANAGE)) return allowDecision()
  if (
    actor.principalId &&
    actor.principalType !== 'service' &&
    message.senderType === 'visitor' &&
    message.authorPrincipalId === actor.principalId &&
    conversation.visitorPrincipalId === actor.principalId
  ) {
    return allowDecision()
  }
  return denyDecision('You can only delete your own messages')
}

/**
 * Who may edit a message: only the author of an agent-side message, and only while they still hold the
 * permission that writes that kind of message (a reply or a note, on a
 * conversation or a ticket). Unlike delete, a teammate cannot rewrite someone
 * else's words. Service principals are excluded. System rows are refused by
 * the caller before this check (they have no author).
 */
export function canEditMessage(
  actor: Actor,
  message: {
    senderType: 'visitor' | 'agent' | 'system'
    authorPrincipalId: PrincipalId | null
    parent: 'conversation' | 'ticket'
    isInternal: boolean
  }
): Decision {
  if (!actor.principalId) return denyDecision('A session is required to edit a message')
  if (actor.principalType === 'service')
    return denyDecision('Service principals cannot edit messages')
  // A teammate can also write as a customer; that row stays the customer's.
  if (message.senderType !== 'agent') return denyDecision('Only agent messages can be edited')
  if (!message.authorPrincipalId || message.authorPrincipalId !== actor.principalId) {
    return denyDecision('You can only edit your own messages')
  }
  return authorize(actor, editPermissionFor(message))
}

/** The permission that writes this kind of message, and so gates editing it. */
function editPermissionFor(message: {
  parent: 'conversation' | 'ticket'
  isInternal: boolean
}): PermissionKey {
  if (message.parent === 'ticket') {
    return message.isInternal ? PERMISSIONS.TICKET_NOTE : PERMISSIONS.TICKET_REPLY
  }
  return message.isInternal ? PERMISSIONS.CONVERSATION_NOTE : PERMISSIONS.CONVERSATION_REPLY
}
