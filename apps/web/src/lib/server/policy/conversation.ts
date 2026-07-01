/**
 * Live chat authorization.
 *
 * Mirrors the policy module contract (see policy/types.ts): pure functions
 * returning an explicit Decision so every deny carries a machine-readable
 * reason. Conversations are owned by a single visitor principal; the support
 * team sees and acts on all of them.
 */
import { allowDecision, denyDecision, type Actor, type Decision } from './types'
import { can } from './authorize'
import { PERMISSIONS } from '@/lib/shared/permissions'
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
  if (!actor.principalId) return denyDecision('A chat session is required to send a message')
  if (actor.principalType === 'service')
    return denyDecision('Service principals cannot send chat messages')
  if (actor.principalId !== conv.visitorPrincipalId)
    return denyDecision('You do not have access to this conversation')
  return allowDecision()
}

/** Who may start a new conversation: any visitor (anonymous or identified) that
 * has a resolved principal. Service principals are excluded. */
export function canStartConversation(actor: Actor): Decision {
  if (!actor.principalId) return denyDecision('A chat session is required to start a conversation')
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
