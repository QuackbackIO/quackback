/**
 * Support-platform ticket tools: read the ticket list + a single ticket with its
 * thread, and write (open a ticket, reply, add an internal note). Team-only
 * agent surfaces gated on the chat scopes — tickets share the conversation
 * scopes (see api-key-scopes): reads need read:chat, writes need write:chat.
 * Status changes + assignment need an id-discovery tool first; a later slice.
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { TicketId, PrincipalId, CompanyId } from '@quackback/ids'
import type {
  TicketType,
  TicketStatusCategory,
  TicketStage,
  ConversationAttachment,
} from '@/lib/server/db'
import type { TicketSort } from '@/lib/server/domains/tickets/ticket.types'
import type { McpAuthContext } from '../types'
import { markdownToTiptapJson, contentJsonToMarkdown } from '@/lib/server/markdown-tiptap'
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'
import {
  registerTool,
  mcpAgentActor,
  jsonResult,
  compactJsonResult,
  READ_ONLY,
  WRITE,
} from './helpers'

const TICKET_TYPES = ['customer', 'back_office', 'tracker'] as const
const TICKET_CATEGORIES = ['open', 'pending', 'closed'] as const
const TICKET_STAGES = ['received', 'in_progress', 'awaiting_requester', 'resolved'] as const
const TICKET_SORTS = ['recent', 'oldest', 'created', 'priority'] as const
const TICKET_PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const

/** Markdown format note appended to the write tools' content/description fields.
 *  Unlike posts/changelog/articles, ticket messages do not auto-rehost external
 *  images — omit that claim here. */
const TICKET_MARKDOWN_DESCRIBE =
  'Markdown (GFM): headings, bold/italic, links, ordered/bulleted lists, code blocks, images via ![alt](url).'

/**
 * Parse MCP-supplied markdown into a sanitized TipTap doc. The ticket domain
 * (unlike posts/changelog/articles) does not derive `contentJson` from
 * markdown itself — see `createTicketCore` / `insertTicketMessage`, which only
 * sanitize a doc the caller already supplied — so the MCP write tools convert
 * here before calling the service, same as a rich-editor client would.
 */
function markdownToSanitizedJson(markdown: string) {
  return sanitizeTiptapContent(markdownToTiptapJson(markdown))
}

/** Append a compact attachments summary to a message's rendered body, when present. */
function withAttachmentsSummary(content: string, attachments: ConversationAttachment[]): string {
  if (!attachments.length) return content
  const lines = attachments.map((a) => `- ${a.name}: ${a.url}`)
  return `${content}\n\nAttachments:\n${lines.join('\n')}`
}

export function registerTicketTools(server: McpServer, auth: McpAuthContext) {
  registerTool<{
    type?: TicketType
    statusCategory?: TicketStatusCategory
    stage?: TicketStage
    requesterPrincipalId?: string
    companyId?: string
    sort?: TicketSort
    limit?: number
  }>(server, auth, {
    name: 'list_tickets',
    description: `List support tickets. Filter by type, internal status category, customer-facing stage, requester, or company; sort and cap with limit. A service key sees every ticket; a human caller sees the tickets their role can view.

Examples:
- Open customer tickets: list_tickets({ type: "customer", statusCategory: "open" })
- A company's tickets: list_tickets({ companyId: "company_01abc..." })`,
    schema: {
      type: z.enum(TICKET_TYPES).optional().describe('Filter by ticket type'),
      statusCategory: z
        .enum(TICKET_CATEGORIES)
        .optional()
        .describe('Filter by internal status category'),
      stage: z.enum(TICKET_STAGES).optional().describe('Filter by customer-facing public stage'),
      requesterPrincipalId: z
        .string()
        .optional()
        .describe('Filter to a requester (principal TypeID)'),
      companyId: z.string().optional().describe('Filter to a company (company TypeID)'),
      sort: z.enum(TICKET_SORTS).optional().describe('Sort order (default recent)'),
      limit: z.number().int().min(1).max(100).optional().describe('Max results (default 20)'),
    },
    annotations: READ_ONLY,
    scope: 'read:chat',
    teamOnly: true,
    handler: async (args) => {
      const { listTickets } = await import('@/lib/server/domains/tickets/ticket.service')
      const tickets = await listTickets(
        {
          type: args.type,
          statusCategory: args.statusCategory,
          stage: args.stage,
          requesterPrincipalId: args.requesterPrincipalId as PrincipalId | undefined,
          companyId: args.companyId as CompanyId | undefined,
          sort: args.sort,
          limit: args.limit ?? 20,
        },
        mcpAgentActor(auth)
      )
      return compactJsonResult({
        tickets: tickets.map((t) => ({
          id: t.id,
          number: t.number,
          reference: t.reference,
          type: t.type,
          title: t.title,
          status: t.status.name,
          statusCategory: t.status.category,
          stage: t.stage.slot,
          priority: t.priority,
          requesterPrincipalId: t.requester?.principalId ?? null,
          assigneePrincipalId: t.assignee.principalId,
          assigneeTeamId: t.assignee.teamId,
          updatedAt: t.updatedAt,
        })),
      })
    },
  })

  registerTool<{
    ticketId: string
    includeInternal?: boolean
    cursor?: string
  }>(server, auth, {
    name: 'get_ticket',
    description: `Get a ticket and its most recent thread messages, oldest-first. Set includeInternal to also return internal teammate notes.

Example: get_ticket({ ticketId: "ticket_01abc...", includeInternal: true })`,
    schema: {
      ticketId: z.string().describe('Ticket TypeID'),
      includeInternal: z
        .boolean()
        .optional()
        .default(false)
        .describe('Include internal teammate notes'),
      cursor: z
        .string()
        .optional()
        .describe('Message ID cursor from a previous get_ticket response, to fetch older messages'),
    },
    annotations: READ_ONLY,
    scope: 'read:chat',
    teamOnly: true,
    handler: async (args) => {
      const { getTicket } = await import('@/lib/server/domains/tickets/ticket.service')
      const { listTicketMessages } =
        await import('@/lib/server/domains/tickets/ticket-message.service')
      const ticketId = args.ticketId as TicketId
      const [dto, page] = await Promise.all([
        getTicket(ticketId),
        listTicketMessages(ticketId, {
          before: args.cursor,
          includeInternal: args.includeInternal ?? false,
        }),
      ])
      const nextCursor = page.hasMore && page.messages.length ? page.messages[0].id : null
      return jsonResult({
        ticket: {
          id: dto.id,
          number: dto.number,
          reference: dto.reference,
          type: dto.type,
          title: dto.title,
          status: { name: dto.status.name, category: dto.status.category },
          stage: dto.stage.slot,
          priority: dto.priority,
          requesterPrincipalId: dto.requester?.principalId ?? null,
          assigneePrincipalId: dto.assignee.principalId,
          assigneeTeamId: dto.assignee.teamId,
          companyId: dto.company?.id ?? null,
          firstResponseAt: dto.firstResponseAt,
          dueAt: dto.dueAt,
          resolvedAt: dto.resolvedAt,
          createdAt: dto.createdAt,
          updatedAt: dto.updatedAt,
          reopenedCount: dto.reopenedCount,
        },
        messages: page.messages.map((m) => ({
          id: m.id,
          senderType: m.senderType,
          isInternal: m.isInternal,
          authorName: m.author?.displayName ?? null,
          content: withAttachmentsSummary(
            contentJsonToMarkdown(m.contentJson, m.content),
            m.attachments ?? []
          ),
          createdAt: m.createdAt,
        })),
        hasMore: page.hasMore,
        nextCursor,
      })
    },
  })

  registerTool<{
    type: TicketType
    title: string
    description?: string
    priority?: 'none' | 'low' | 'medium' | 'high' | 'urgent'
    requesterPrincipalId?: string
    companyId?: string
  }>(server, auth, {
    name: 'create_ticket',
    description: `Open a support ticket. type is customer (a requester's request), back_office (an internal task), or tracker (an umbrella others link to). A description opens the thread. Returns the created ticket.

Example: create_ticket({ type: "customer", title: "Refund not received", description: "Customer reports a missing refund from last week." })`,
    schema: {
      type: z.enum(TICKET_TYPES).describe('Ticket object type'),
      title: z.string().min(1).max(300).describe('Short summary'),
      description: z
        .string()
        .max(10000)
        .optional()
        .describe(`Opening message body (optional). ${TICKET_MARKDOWN_DESCRIBE}`),
      priority: z.enum(TICKET_PRIORITIES).optional().describe('Triage priority (default none)'),
      requesterPrincipalId: z
        .string()
        .optional()
        .describe('The requester principal TypeID (optional)'),
      companyId: z.string().optional().describe('Associated company TypeID (optional)'),
    },
    annotations: WRITE,
    scope: 'write:chat',
    teamOnly: true,
    handler: async (args) => {
      const { createTicket } = await import('@/lib/server/domains/tickets/ticket.service')
      // Always populate descriptionJson from the markdown when a description is
      // given (mirrors createPost's unconditional contentJson derivation) — a
      // plain single-line description still yields a minimal valid doc.
      const descriptionJson = args.description
        ? markdownToSanitizedJson(args.description)
        : undefined
      const dto = await createTicket(
        {
          type: args.type,
          title: args.title,
          description: args.description,
          descriptionJson,
          priority: args.priority,
          requesterPrincipalId: args.requesterPrincipalId as PrincipalId | undefined,
          companyId: args.companyId as CompanyId | undefined,
        },
        mcpAgentActor(auth)
      )
      return jsonResult({
        id: dto.id,
        number: dto.number,
        reference: dto.reference,
        type: dto.type,
        title: dto.title,
        status: { name: dto.status.name, category: dto.status.category },
        stage: dto.stage.slot,
        priority: dto.priority,
      })
    },
  })

  registerTool<{ ticketId: string; content: string }>(server, auth, {
    name: 'reply_to_ticket',
    description: `Post a reply on a ticket thread (visible to the requester). Stamps the first-response time on the first reply.

Example: reply_to_ticket({ ticketId: "ticket_01abc...", content: "We've issued your refund; it should arrive in 3-5 days." })`,
    schema: {
      ticketId: z.string().describe('Ticket TypeID'),
      content: z
        .string()
        .min(1)
        .max(10000)
        .describe(`Reply text, visible to the requester. ${TICKET_MARKDOWN_DESCRIBE}`),
    },
    annotations: WRITE,
    scope: 'write:chat',
    teamOnly: true,
    handler: async (args) => {
      const { sendTicketMessage } =
        await import('@/lib/server/domains/tickets/ticket-message.service')
      const { message } = await sendTicketMessage(mcpAgentActor(auth), {
        ticketId: args.ticketId as TicketId,
        content: args.content,
        contentJson: markdownToSanitizedJson(args.content),
      })
      return jsonResult({
        id: message.id,
        ticketId: message.ticketId,
        createdAt: message.createdAt,
      })
    },
  })

  registerTool<{ ticketId: string; content: string }>(server, auth, {
    name: 'add_ticket_note',
    description: `Add an internal note to a ticket thread. Never visible to the requester — only the support team sees it.

Example: add_ticket_note({ ticketId: "ticket_01abc...", content: "Confirmed the refund with billing; awaiting bank processing." })`,
    schema: {
      ticketId: z.string().describe('Ticket TypeID'),
      content: z
        .string()
        .min(1)
        .max(10000)
        .describe(`Internal note text (team-only). ${TICKET_MARKDOWN_DESCRIBE}`),
    },
    annotations: WRITE,
    scope: 'write:chat',
    teamOnly: true,
    handler: async (args) => {
      const { addTicketNote } = await import('@/lib/server/domains/tickets/ticket-message.service')
      const { message } = await addTicketNote(mcpAgentActor(auth), {
        ticketId: args.ticketId as TicketId,
        content: args.content,
        contentJson: markdownToSanitizedJson(args.content),
      })
      return jsonResult({
        id: message.id,
        ticketId: message.ticketId,
        createdAt: message.createdAt,
      })
    },
  })

  registerTool<{ trackerTicketId: string; ticketId: string }>(server, auth, {
    name: 'link_ticket',
    description: `Link a customer ticket to a tracker so the tracker's stage changes cascade onto it. The tracker must be type "tracker" and the ticket type "customer"; a customer ticket belongs to at most one tracker. Returns the tracker's linked tickets.

Example: link_ticket({ trackerTicketId: "ticket_01tracker...", ticketId: "ticket_01customer..." })`,
    schema: {
      trackerTicketId: z.string().describe('The tracker ticket TypeID'),
      ticketId: z.string().describe('The customer ticket TypeID to track'),
    },
    annotations: WRITE,
    scope: 'write:chat',
    teamOnly: true,
    handler: async (args) => {
      const { linkTicketToTracker, listLinkedTicketIds } =
        await import('@/lib/server/domains/tickets/ticket-links.service')
      const trackerTicketId = args.trackerTicketId as TicketId
      await linkTicketToTracker(trackerTicketId, args.ticketId as TicketId, mcpAgentActor(auth))
      return jsonResult({
        trackerTicketId,
        linkedTicketIds: await listLinkedTicketIds(trackerTicketId),
      })
    },
  })

  registerTool<{ trackerTicketId: string; ticketId: string }>(server, auth, {
    name: 'unlink_ticket',
    description: `Remove a customer ticket from a tracker. Returns the tracker's remaining linked tickets.

Example: unlink_ticket({ trackerTicketId: "ticket_01tracker...", ticketId: "ticket_01customer..." })`,
    schema: {
      trackerTicketId: z.string().describe('The tracker ticket TypeID'),
      ticketId: z.string().describe('The linked customer ticket TypeID'),
    },
    annotations: WRITE,
    scope: 'write:chat',
    teamOnly: true,
    handler: async (args) => {
      const { unlinkTicketFromTracker, listLinkedTicketIds } =
        await import('@/lib/server/domains/tickets/ticket-links.service')
      const trackerTicketId = args.trackerTicketId as TicketId
      await unlinkTicketFromTracker(trackerTicketId, args.ticketId as TicketId, mcpAgentActor(auth))
      return jsonResult({
        trackerTicketId,
        linkedTicketIds: await listLinkedTicketIds(trackerTicketId),
      })
    },
  })
}
