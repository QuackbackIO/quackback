import { isTypeId, toUuid } from '@quackback/ids'
import { db, sql, type Database, type Transaction } from '@/lib/server/db'
import type { SQL } from 'drizzle-orm'
import {
  isTestPrincipalSql,
  knownTestOwner,
  notTestConversation,
  notTestTicket,
} from '@/lib/server/test-data'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function idList(ids: string[]): SQL {
  return sql.join(
    ids.map((id) => sql`${toUuid(id)}::uuid`),
    sql`, `
  )
}

/**
 * Read only known event references; authored content cannot select an audience.
 * An event is test when any reference resolves to a test customer's identity:
 * the principal itself, or the conversation, post, ticket, message or comment
 * a test customer authored. One read answers all of them, and principals the
 * process already knows answer without one.
 */
export async function isTestEvent(
  event: { entityId?: string; payload: unknown; actorId?: string },
  executor: Database | Transaction = db
): Promise<boolean> {
  const data = record(event.payload)
  const refs = new Set(
    [
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
    ].filter((id): id is string => typeof id === 'string')
  )

  const principals: string[] = []
  const conversationIds: string[] = []
  const postIds: string[] = []
  const ticketIds: string[] = []
  const messageIds: string[] = []
  const commentIds: string[] = []
  for (const id of refs) {
    if (isTypeId(id, 'principal')) {
      const known = knownTestOwner(id)
      if (known) return true
      if (known === undefined) principals.push(id)
    } else if (isTypeId(id, 'conversation')) conversationIds.push(id)
    else if (isTypeId(id, 'post')) postIds.push(id)
    else if (isTypeId(id, 'ticket')) ticketIds.push(id)
    else if (isTypeId(id, 'conversation_msg')) messageIds.push(id)
    else if (isTypeId(id, 'post_comment')) commentIds.push(id)
  }

  const probes: SQL[] = []
  if (principals.length > 0) {
    probes.push(
      sql`select 1 from principal where id in (${idList(principals)}) and test_owner_principal_id is not null`
    )
  }
  if (conversationIds.length > 0) {
    probes.push(
      sql`select 1 from conversations where id in (${idList(conversationIds)}) and ${isTestPrincipalSql(sql`visitor_principal_id`)}`
    )
  }
  if (postIds.length > 0) {
    probes.push(
      sql`select 1 from posts where id in (${idList(postIds)}) and ${isTestPrincipalSql(sql`principal_id`)}`
    )
  }
  if (ticketIds.length > 0) {
    probes.push(
      sql`select 1 from tickets where id in (${idList(ticketIds)}) and not (${notTestTicket(sql`tickets.id`)})`
    )
  }
  if (messageIds.length > 0) {
    probes.push(
      sql`select 1 from conversation_messages test_message where test_message.id in (${idList(messageIds)}) and (
        ${isTestPrincipalSql(sql`test_message.principal_id`)}
        or (test_message.conversation_id is not null and not (${notTestConversation(sql`test_message.conversation_id`)}))
        or (test_message.ticket_id is not null and not (${notTestTicket(sql`test_message.ticket_id`)}))
      )`
    )
  }
  if (commentIds.length > 0) {
    probes.push(
      sql`select 1 from post_comments test_comment inner join posts test_post on test_post.id = test_comment.post_id
        where test_comment.id in (${idList(commentIds)})
          and (${isTestPrincipalSql(sql`test_comment.principal_id`)} or ${isTestPrincipalSql(sql`test_post.principal_id`)})`
    )
  }
  if (probes.length === 0) return false

  const rows = getExecuteRows<{ test: boolean }>(
    await executor.execute(sql`select exists (${sql.join(probes, sql` union all `)}) as test`)
  )
  return rows[0]?.test === true
}
