/**
 * Conversation export (Imports & exports hub §I3): full message content as
 * NDJSON — an OSS differentiator versus Intercom's paid full-content export.
 * Capped like the posts/companies CSV exports so a very large workspace
 * can't exhaust memory building the response.
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
  desc,
  inArray,
} from '@/lib/server/db'
import { realEmail } from '@/lib/shared/anonymous-email'

export const MAX_EXPORT_CONVERSATIONS = 5000

export interface ConversationExportMessage {
  id: string
  senderType: string
  content: string
  isInternal: boolean
  createdAt: string
}

export interface ConversationExportTicketRef {
  id: string
  type: string
}

export interface ConversationExportRow {
  id: string
  status: string
  channel: string
  createdAt: string
  visitorEmail: string | null
  tickets: ConversationExportTicketRef[]
  messages: ConversationExportMessage[]
}

/**
 * Full conversation history (newest first, capped), with linked ticket
 * references and every non-deleted message's plain-text content.
 */
export async function listConversationsForExport(): Promise<ConversationExportRow[]> {
  const rows = await db.query.conversations.findMany({
    orderBy: desc(conversations.createdAt),
    limit: MAX_EXPORT_CONVERSATIONS,
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
  const ticketsByConversation = new Map<string, ConversationExportTicketRef[]>()
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
