/**
 * Conversations exporter — NDJSON, same shape as the interactive
 * /api/export/conversations route (full message content + ticket refs),
 * paged instead of the route's 5k cap. Smaller page size than the CSV
 * entities: each row carries its whole message thread.
 */
import {
  db,
  conversations,
  conversationMessages,
  ticketConversations,
  principal,
  user,
  eq,
  isNull,
  asc,
  inArray,
} from '@/lib/server/db'
import { realEmail } from '@/lib/shared/anonymous-email'
import type { ConversationExportRow } from '@/lib/server/domains/conversation/conversation.export'
import type { EntityExporter } from '../types'

async function fetchConversations(offset: number, limit: number): Promise<ConversationExportRow[]> {
  const rows = await db.query.conversations.findMany({
    orderBy: asc(conversations.createdAt),
    offset,
    limit,
    columns: { id: true, status: true, channel: true, createdAt: true, visitorPrincipalId: true },
    with: {
      messages: {
        where: isNull(conversationMessages.deletedAt),
        orderBy: asc(conversationMessages.createdAt),
        columns: { id: true, senderType: true, content: true, isInternal: true, createdAt: true },
      },
    },
  })
  if (rows.length === 0) return []

  const conversationIds = rows.map((c) => c.id)
  const visitorIds = [...new Set(rows.map((r) => r.visitorPrincipalId))]

  const [visitorEmails, ticketLinks] = await Promise.all([
    db
      .select({ principalId: principal.id, email: user.email })
      .from(principal)
      .innerJoin(user, eq(principal.userId, user.id))
      .where(inArray(principal.id, visitorIds)),
    db
      .select({
        conversationId: ticketConversations.conversationId,
        ticketId: ticketConversations.ticketId,
        ticketType: ticketConversations.ticketType,
      })
      .from(ticketConversations)
      .where(inArray(ticketConversations.conversationId, conversationIds)),
  ])

  const emailMap = new Map(visitorEmails.map((v) => [v.principalId, v.email]))
  const ticketsByConversation = new Map<string, { id: string; type: string }[]>()
  for (const link of ticketLinks) {
    const list = ticketsByConversation.get(link.conversationId) ?? []
    list.push({ id: link.ticketId, type: link.ticketType })
    ticketsByConversation.set(link.conversationId, list)
  }

  return rows.map((c) => ({
    id: c.id,
    status: c.status,
    channel: c.channel,
    createdAt: c.createdAt.toISOString(),
    visitorEmail: realEmail(emailMap.get(c.visitorPrincipalId) ?? null),
    tickets: ticketsByConversation.get(c.id) ?? [],
    messages: c.messages.map((m) => ({
      id: m.id,
      senderType: m.senderType,
      content: m.content,
      isInternal: m.isInternal,
      createdAt: m.createdAt.toISOString(),
    })),
  }))
}

export const conversationsExporter: EntityExporter<ConversationExportRow> = {
  key: 'conversations',
  fileName: 'conversations.jsonl',
  pageSize: 500,
  fetchPage: fetchConversations,
  serialize: (row) => JSON.stringify(row),
}
