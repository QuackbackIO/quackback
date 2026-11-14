/**
 * The per-item conversation visibility check, in one leaf module that depends
 * only on the database and the policy filters, so every domain, server
 * function and route can import it statically.
 *
 * A conversation is visible to the visitor who owns it, and to an actor whose
 * `conversationFilter` admits it (a workspace-wide service principal, a
 * teammate with `conversation.view_all`, or a scoped teammate for a
 * conversation assigned to them or one of their teams). Anyone else gets
 * NotFound, never Forbidden, so a conversation id cannot be probed.
 */
import { and, db, eq, inArray, or, sql, conversations, type Conversation } from '@/lib/server/db'
import { isValidTypeId, type ConversationId } from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'
import { conversationFilter } from '@/lib/server/policy/conversations'
import type { Actor, SystemCascadeOptions } from '@/lib/server/policy/types'

/** The row by id with no visibility check, for system callers only (the guard
 *  test names each one). */
export async function loadConversationOr404(conversationId: ConversationId): Promise<Conversation> {
  const [row] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  if (!row) throw new NotFoundError('CONVERSATION_NOT_FOUND', 'Conversation not found')
  return row
}

/**
 * A conversation the actor may see, or NotFound. One query: the row is the
 * visitor's own, or `conversationFilter` admits it for the actor.
 */
export async function assertConversationVisible(
  conversationId: ConversationId,
  actor: Actor
): Promise<Conversation> {
  const ownConversation =
    actor.principalId != null ? eq(conversations.visitorPrincipalId, actor.principalId) : sql`false`
  const [row] = await db
    .select()
    .from(conversations)
    .where(
      and(eq(conversations.id, conversationId), or(ownConversation, conversationFilter(actor)))
    )
    .limit(1)
  if (!row) throw new NotFoundError('CONVERSATION_NOT_FOUND', 'Conversation not found')
  return row
}

/**
 * Which of `ids` the actor may see, in one query, by the same rule as
 * `assertConversationVisible`. An id that is not a conversation id is left
 * out, like a missing one.
 */
export async function visibleConversationIds(
  ids: readonly string[],
  actor: Actor
): Promise<Set<ConversationId>> {
  const valid = ids.filter((id): id is ConversationId => isValidTypeId(id, 'conversation'))
  if (valid.length === 0) return new Set()
  const ownConversation =
    actor.principalId != null ? eq(conversations.visitorPrincipalId, actor.principalId) : sql`false`
  const rows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(inArray(conversations.id, valid), or(ownConversation, conversationFilter(actor))))
  return new Set(rows.map((r) => r.id as ConversationId))
}

/**
 * The row an agent write acts on: a conversation the actor may see, or
 * NotFound. Under `systemCascade` the caller has checked the item already, so
 * the row is read as it is.
 */
export async function loadConversationForWrite(
  conversationId: ConversationId,
  actor: Actor,
  opts?: SystemCascadeOptions
): Promise<Conversation> {
  if (opts?.systemCascade) return loadConversationOr404(conversationId)
  return assertConversationVisible(conversationId, actor)
}
