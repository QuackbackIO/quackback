import { isTypeId } from '@quackback/ids'
import {
  db,
  eq,
  posts,
  postComments,
  conversations,
  conversationMessages,
  principal,
  tickets,
  and,
  sql,
  type Database,
  type Transaction,
} from '@/lib/server/db'
import { isTestRecord, notTestTicket } from '@/lib/server/test-data'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/** Read only known event references; authored content cannot select an audience. */
export async function isTestEvent(
  event: { entityId?: string; payload: unknown; actorId?: string },
  executor: Database | Transaction = db
): Promise<boolean> {
  const data = record(event.payload)
  const ids = new Set([
    event.entityId,
    event.actorId,
    record(data.post).id,
    record(data.duplicatePost).id,
    record(data.comment).id,
    record(data.conversation).id,
    record(data.message).id,
    record(data.message).conversationId,
    record(data.ticket).id,
    data.conversationId,
    data.messageId,
    data.postId,
    data.principalId,
    data.ticketId,
  ])
  const testIdentity = async (id: string | null) => {
    if (!id || !isTypeId(id, 'principal')) return false
    const row = await executor.query.principal.findFirst({
      where: eq(principal.id, id),
      columns: { testOwnerPrincipalId: true },
    })
    return !!row?.testOwnerPrincipalId
  }
  const testConversation = async (id: string | null) => {
    if (!id || !isTypeId(id, 'conversation')) return false
    const row = await executor.query.conversations.findFirst({
      where: eq(conversations.id, id),
      columns: { customAttributes: true, visitorPrincipalId: true },
    })
    return (
      !!row && (isTestRecord(row.customAttributes) || (await testIdentity(row.visitorPrincipalId)))
    )
  }
  const testPost = async (id: string) => {
    if (!isTypeId(id, 'post')) return false
    const row = await executor.query.posts.findFirst({
      where: eq(posts.id, id),
      columns: { widgetMetadata: true, principalId: true },
    })
    return !!row && (isTestRecord(row.widgetMetadata) || (await testIdentity(row.principalId)))
  }
  const testTicket = async (id: string | null) => {
    if (!id || !isTypeId(id, 'ticket')) return false
    const [row] = await executor
      .select({ id: tickets.id })
      .from(tickets)
      .where(and(eq(tickets.id, id), sql`not (${notTestTicket(tickets.id)})`))
      .limit(1)
    return !!row
  }
  for (const id of ids) {
    if (typeof id !== 'string') continue
    if (isTypeId(id, 'principal') && (await testIdentity(id))) return true
    if (isTypeId(id, 'conversation') && (await testConversation(id))) return true
    if (isTypeId(id, 'post') && (await testPost(id))) return true
    if (isTypeId(id, 'ticket') && (await testTicket(id))) return true
    if (isTypeId(id, 'conversation_msg')) {
      const row = await executor.query.conversationMessages.findFirst({
        where: eq(conversationMessages.id, id),
        columns: { conversationId: true, ticketId: true, principalId: true },
      })
      if (
        row &&
        ((await testConversation(row.conversationId)) ||
          (await testTicket(row.ticketId)) ||
          (await testIdentity(row.principalId)))
      )
        return true
    }
    if (isTypeId(id, 'post_comment')) {
      const row = await executor.query.postComments.findFirst({
        where: eq(postComments.id, id),
        columns: { postId: true, principalId: true },
      })
      if (row && ((await testPost(row.postId)) || (await testIdentity(row.principalId))))
        return true
    }
  }
  return false
}
