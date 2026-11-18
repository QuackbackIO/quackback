/**
 * The per-item conversation check for server functions: the caller's actor,
 * and a conversation they may see, or NotFound like a missing one. A server
 * function that takes a conversation id runs this before it reads or writes
 * anything about the conversation. A plain function, not a server function:
 * only other server functions call it.
 */
import type { ConversationId } from '@quackback/ids'
import type { Conversation } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { assertConversationVisible } from '@/lib/server/domains/conversation/conversation-visibility'
import { policyActorFromAuth, type AuthContext } from './auth-helpers'

export async function requireVisibleConversation(
  ctx: AuthContext,
  conversationId: ConversationId
): Promise<{ actor: Actor; conversation: Conversation }> {
  const actor = await policyActorFromAuth(ctx)
  const conversation = await assertConversationVisible(conversationId, actor)
  return { actor, conversation }
}
