/**
 * Support-platform ticket tools: read the ticket list + a single ticket with its
 * thread. Team-only agent surfaces, gated on the chat scope (tickets share the
 * conversation scopes — see api-key-scopes). Read-only for now; write tools
 * (reply, status) are a later slice.
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { TicketId, PrincipalId, CompanyId } from '@quackback/ids'
import type { TicketType, TicketStatusCategory, TicketStage } from '@/lib/server/db'
import type { TicketSort } from '@/lib/server/domains/tickets/ticket.types'
import type { McpAuthContext } from '../types'
import { registerTool, mcpAgentActor, jsonResult, compactJsonResult, READ_ONLY } from './helpers'

const TICKET_TYPES = ['customer', 'back_office', 'tracker'] as const
const TICKET_CATEGORIES = ['open', 'pending', 'closed'] as const
const TICKET_STAGES = ['received', 'in_progress', 'awaiting_requester', 'resolved'] as const
const TICKET_SORTS = ['recent', 'oldest', 'created', 'priority'] as const

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
          content: m.content,
          createdAt: m.createdAt,
        })),
        hasMore: page.hasMore,
        nextCursor,
      })
    },
  })
}
