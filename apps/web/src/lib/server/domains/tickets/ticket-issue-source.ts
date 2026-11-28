/**
 * What an issue created from a ticket says, read at dispatch: by a teammate's
 * "Create issue" and by a destination's ticket opt-in alike (see
 * `sync/tickets.ts`). Only the customer-visible thread is read, never an
 * internal note or its files, and nothing names the requester.
 */
import {
  db,
  eq,
  and,
  or,
  asc,
  ne,
  isNull,
  conversations,
  conversationMessages,
  ticketStatuses,
} from '@/lib/server/db'
import type { TicketId } from '@quackback/ids'
import type { TicketIssueSource } from '@/lib/server/integrations/types'
import { getBaseUrl } from '@/lib/server/config'
import { contentJsonToMarkdown } from '@/lib/server/markdown-tiptap'
import { truncate } from '@/lib/shared/utils/string'
import { loadTicketOr404 } from './ticket.service'
import { resolvePairConversationId } from './pair-thread.service'

/**
 * Read current customer-visible content at dispatch time, excluding removed
 * messages and internal notes: the ticket as a provider may render it
 * (`ticket`, see `IssueTrackerCapability.formatTicketIssue`), and the plain
 * rendering every other provider sends, its narrative and a back-link.
 */
export async function buildTicketIssueData(
  ticketId: TicketId
): Promise<{ title: string; bodyMarkdown: string; ticket: TicketIssueSource }> {
  const ticket = await loadTicketOr404(ticketId)
  const pairConversationId = await resolvePairConversationId(ticketId)
  const messages = await db
    .select({
      content: conversationMessages.content,
      contentJson: conversationMessages.contentJson,
      attachments: conversationMessages.attachments,
    })
    .from(conversationMessages)
    .where(
      and(
        pairConversationId
          ? or(
              eq(conversationMessages.ticketId, ticketId),
              eq(conversationMessages.conversationId, pairConversationId)
            )
          : eq(conversationMessages.ticketId, ticketId),
        ne(conversationMessages.senderType, 'system'),
        eq(conversationMessages.isInternal, false),
        isNull(conversationMessages.deletedAt)
      )
    )
    .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id))
  const [first] = messages
  const [status] = await db
    .select({ name: ticketStatuses.name })
    .from(ticketStatuses)
    .where(eq(ticketStatuses.id, ticket.statusId))
    .limit(1)
  const [conversation] = pairConversationId
    ? await db
        .select({ channel: conversations.channel })
        .from(conversations)
        .where(eq(conversations.id, pairConversationId))
        .limit(1)
    : []
  const url = `${getBaseUrl()}/admin/inbox?i=${ticketId}`
  const source: TicketIssueSource = {
    ticketId,
    number: ticket.number,
    title: ticket.title,
    narrative: first ? contentJsonToMarkdown(first.contentJson, first.content) : '',
    attachments: messages.flatMap((m) =>
      (m.attachments ?? []).map((a) => ({ name: a.name, url: a.url, contentType: a.contentType }))
    ),
    status: status?.name ?? null,
    priority: ticket.priority,
    channel: conversation?.channel ?? null,
    url,
  }
  const bodyMarkdown = [
    truncate(source.narrative, 2000),
    `---`,
    `Created from Quackback ticket #${ticket.number}: ${url}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  return { title: ticket.title, bodyMarkdown, ticket: source }
}
