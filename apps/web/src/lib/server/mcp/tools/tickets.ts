/**
 * Support-platform ticket tools: read the ticket list + a single ticket with its
 * thread, and write (open a ticket, reply, add an internal note, link/unlink a
 * tracker, set the shared due date), plus the ticket's watchers (list,
 * watch/unwatch yourself, add/remove a teammate) and the customers it is shared
 * with (list, share by email, stop sharing). Team-only agent surfaces gated on
 * the chat scopes — tickets share the conversation scopes (see api-key-scopes):
 * reads need read:chat, writes need write:chat.
 * Status changes + assignment need an id-discovery tool first; a later slice.
 */

import { PERMISSIONS } from '@/lib/shared/permissions'
import { TICKET_SORTS } from '@/lib/shared/tickets'
import { TICKET_DUE_FILTERS, type TicketDueFilter } from '@/lib/shared/ticket-due'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { TicketId, TicketTypeId, PrincipalId, CompanyId } from '@quackback/ids'
import type {
  TicketType,
  TicketStatusCategory,
  TicketStage,
  ConversationAttachment,
} from '@/lib/server/db'
import type { TicketSort } from '@/lib/server/domains/tickets/ticket.types'
import type { McpAuthContext } from '../types'
import { getBaseUrl } from '@/lib/server/config'
import { ValidationError } from '@/lib/shared/errors'
import { markdownToTiptapJson, contentJsonToMarkdown } from '@/lib/server/markdown-tiptap'
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'
import type { TicketWatcher } from '@/lib/server/domains/tickets/ticket-subscription.service'
import {
  registerTool,
  attachmentsFromFileIds,
  mcpAgentActor,
  principalTypeOf,
  jsonResult,
  compactJsonResult,
  withAuthorFacts,
  READ_ONLY,
  WRITE,
  type AuthorAt,
} from './helpers'

const TICKET_TYPES = ['customer', 'back_office', 'tracker'] as const
const TICKET_CATEGORIES = ['open', 'pending', 'closed'] as const
const TICKET_STAGES = ['received', 'in_progress', 'awaiting_requester', 'resolved'] as const
const TICKET_PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const

/** The due-date wire format: an exact instant, so the caller owns the time zone. */
const TICKET_DUE_AT_DESCRIBE =
  'ISO 8601 instant with a Z or offset (e.g. "2026-11-03T17:00:00Z"); allowed from a year ago to five years ahead'

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

/**
 * Watching is personal: an API key acts as a service principal, which has no
 * watch of its own and gets no notifications, so the self-watch paths need a
 * signed-in person.
 */
function requirePersonCaller(auth: McpAuthContext, action: string): void {
  if (principalTypeOf(auth) !== 'user') {
    throw new ValidationError(
      'PERSON_REQUIRED',
      `An API key cannot ${action}: watching is per person. Sign in as a teammate, or use add_ticket_watcher for someone else.`
    )
  }
}

/** The public watcher shape: names and avatars, never an email. */
function watcherResult(w: TicketWatcher) {
  return {
    principalId: w.principalId,
    displayName: w.displayName,
    isTeamMember: w.isTeamMember,
    reason: w.reason,
    mutedUntil: w.mutedUntil ? new Date(w.mutedUntil).toISOString() : null,
  }
}

async function watchersResult(ticketId: TicketId, auth: McpAuthContext) {
  const { listWatchersOfTicket } =
    await import('@/lib/server/domains/tickets/ticket-watchers.service')
  const watchers = await listWatchersOfTicket(ticketId, mcpAgentActor(auth))
  return jsonResult({ ticketId, watchers: watchers.map(watcherResult) })
}

/** The customers a ticket is shared with: names and the address it was shared with. */
async function participantsResult(ticketId: TicketId, auth: McpAuthContext) {
  const { listTicketParticipants } =
    await import('@/lib/server/domains/tickets/ticket-sharing.service')
  const participants = await listTicketParticipants(ticketId, mcpAgentActor(auth))
  return jsonResult({
    ticketId,
    participants: participants.map((p) => ({
      principalId: p.principalId,
      displayName: p.displayName,
      email: p.email,
    })),
  })
}

export function registerTicketTools(server: McpServer, auth: McpAuthContext) {
  registerTool<{
    type?: TicketType
    ticketTypeId?: string
    statusCategory?: TicketStatusCategory
    stage?: TicketStage
    requesterPrincipalId?: string
    companyId?: string
    due?: TicketDueFilter
    watching?: boolean
    watcherPrincipalId?: string
    sort?: TicketSort
    limit?: number
  }>(server, auth, {
    name: 'list_tickets',
    permissions: [PERMISSIONS.TICKET_VIEW],
    description: `List support tickets. Filter by type, registry ticket-type, internal status category, customer-facing stage, requester, company, or due date; sort and cap with limit. A service key sees every ticket; a human caller sees the tickets their role can view.

Examples:
- Open customer tickets: list_tickets({ type: "customer", statusCategory: "open" })
- Overdue tickets, most urgent first: list_tickets({ due: "overdue", sort: "due" })
- Tickets of one registry type: list_tickets({ ticketTypeId: "ticket_type_01abc..." })
- A company's tickets: list_tickets({ companyId: "company_01abc..." })
- Tickets you watch: list_tickets({ watching: true })`,
    schema: {
      type: z.enum(TICKET_TYPES).optional().describe('Filter by ticket type'),
      ticketTypeId: z
        .string()
        .optional()
        .describe('Filter by registry ticket-type (ticket_type TypeID)'),
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
      due: z
        .enum(TICKET_DUE_FILTERS)
        .optional()
        .describe(
          'Filter by due date: overdue (past due, still open), due_soon (due within 24 hours, still open), or none (no due date)'
        ),
      watching: z
        .boolean()
        .optional()
        .describe('Only tickets you watch (a signed-in person, not an API key)'),
      watcherPrincipalId: z
        .string()
        .optional()
        .describe('Only tickets this teammate watches (principal TypeID)'),
      sort: z
        .enum(TICKET_SORTS)
        .optional()
        .describe('Sort order (default recent); due puts the soonest due date first'),
      limit: z.number().int().min(1).max(100).optional().describe('Max results (default 20)'),
    },
    annotations: READ_ONLY,
    scope: 'read:chat',
    teamOnly: true,
    handler: async (args) => {
      if (args.watching) requirePersonCaller(auth, 'list the tickets you watch')
      const { listTickets } = await import('@/lib/server/domains/tickets/ticket.service')
      // The wire contract stays a bare list (no cursor param exposed here yet);
      // `hasMore` is dropped, mirroring the admin ticket list fn.
      const { tickets } = await listTickets(
        {
          type: args.type,
          ticketTypeId: args.ticketTypeId as TicketTypeId | undefined,
          statusCategory: args.statusCategory,
          stage: args.stage,
          requesterPrincipalId: args.requesterPrincipalId as PrincipalId | undefined,
          companyId: args.companyId as CompanyId | undefined,
          due: args.due,
          watcherPrincipalId: args.watching
            ? (auth.principalId as PrincipalId)
            : (args.watcherPrincipalId as PrincipalId | undefined),
          sort: args.sort,
          limit: args.limit ?? 20,
        },
        mcpAgentActor(auth)
      )
      const origin = getBaseUrl()
      return compactJsonResult({
        tickets: tickets.map((t) => ({
          id: t.id,
          url: `${origin}/admin/inbox?i=${t.id}`,
          number: t.number,
          reference: t.reference,
          type: t.type,
          ticketType: t.ticketType
            ? { id: t.ticketType.id, name: t.ticketType.name, slug: t.ticketType.slug }
            : null,
          title: t.title,
          status: t.status.name,
          statusCategory: t.status.category,
          stage: t.stage.slot,
          priority: t.priority,
          requesterPrincipalId: t.requester?.principalId ?? null,
          assigneePrincipalId: t.assignee.principalId,
          assigneeTeamId: t.assignee.teamId,
          dueAt: t.dueAt,
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
    permissions: [PERMISSIONS.TICKET_VIEW],
    description: `Get a ticket and its most recent thread messages, oldest-first. For a conversation-linked customer ticket the thread is the pair's shared thread (the conversation's messages plus the ticket's own legacy/internal rows). Set includeInternal to also return internal teammate notes.

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
          preferAccountName: true,
        }),
      ])
      const nextCursor = page.hasMore && page.messages.length ? page.messages[0].id : null
      const result = jsonResult({
        ticket: {
          id: dto.id,
          number: dto.number,
          reference: dto.reference,
          type: dto.type,
          ticketType: dto.ticketType,
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
      return withAuthorFacts(
        result,
        page.messages.map((m, i): AuthorAt => [`messages[${i}]`, m.author?.principalId])
      )
    },
  })

  registerTool<{
    type?: TicketType
    ticketTypeId?: string
    title: string
    description?: string
    priority?: 'none' | 'low' | 'medium' | 'high' | 'urgent'
    requesterPrincipalId?: string
    companyId?: string
    dueAt?: string
  }>(server, auth, {
    name: 'create_ticket',
    permissions: [PERMISSIONS.TICKET_CREATE],
    description: `Open a support ticket. type is customer (a requester's request), back_office (an internal task), or tracker (an umbrella others link to). Pass ticketTypeId to file under a workspace-defined registry type instead — its category then determines type (discover ids via list_tickets' ticketType field). A description opens the thread. dueAt sets the due date shared with the customer (independent of SLA targets). Returns the created ticket.

Example: create_ticket({ type: "customer", title: "Refund not received", description: "Customer reports a missing refund from last week.", dueAt: "2026-11-03T17:00:00Z" })`,
    schema: {
      type: z
        .enum(TICKET_TYPES)
        .optional()
        .describe('Ticket object type (default customer; derived when ticketTypeId is given)'),
      ticketTypeId: z
        .string()
        .optional()
        .describe('Registry ticket-type (ticket_type TypeID); its category becomes the type'),
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
      dueAt: z
        .string()
        .datetime({ offset: true })
        .optional()
        .describe(`Due date shared with the customer (optional). ${TICKET_DUE_AT_DESCRIBE}`),
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
          ticketTypeId: args.ticketTypeId as TicketTypeId | undefined,
          title: args.title,
          description: args.description,
          descriptionJson,
          priority: args.priority,
          requesterPrincipalId: args.requesterPrincipalId as PrincipalId | undefined,
          companyId: args.companyId as CompanyId | undefined,
          dueAt: args.dueAt ? new Date(args.dueAt) : undefined,
          // CONVERGENCE PHASE 1b: a customer-intake path — a CUSTOMER ticket
          // created WITH a requester gets its backing conversation + link in
          // the same transaction (createTicketCore's doc carries the
          // contract). Requester-less and non-customer creates are unchanged.
          withBackingConversation: true,
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
        dueAt: dto.dueAt,
      })
    },
  })

  registerTool<{
    ticketId: string
    title?: string
    priority?: 'none' | 'low' | 'medium' | 'high' | 'urgent'
  }>(server, auth, {
    name: 'update_ticket',
    permissions: [PERMISSIONS.TICKET_SET_STATUS],
    description: `Rename a ticket, change its triage priority, or both. Pass only the fields to change; a field equal to its current value changes nothing.

Example: update_ticket({ ticketId: "ticket_01abc...", title: "Cannot log in with SSO", priority: "high" })`,
    schema: {
      ticketId: z.string().describe('Ticket TypeID'),
      title: z.string().trim().min(1).max(300).optional().describe('New ticket title'),
      priority: z.enum(TICKET_PRIORITIES).optional().describe('New triage priority'),
    },
    annotations: { ...WRITE, idempotentHint: true },
    scope: 'write:chat',
    teamOnly: true,
    handler: async (args) => {
      if (args.title === undefined && args.priority === undefined) {
        throw new ValidationError('VALIDATION_ERROR', 'Pass a title, a priority, or both')
      }
      const { getTicket, setTicketTitle, setTicketPriority } =
        await import('@/lib/server/domains/tickets/ticket.service')
      const ticketId = args.ticketId as TicketId
      const actor = mcpAgentActor(auth)
      if (args.title !== undefined) await setTicketTitle(ticketId, args.title, actor)
      if (args.priority !== undefined) await setTicketPriority(ticketId, args.priority, actor)
      const dto = await getTicket(ticketId)
      return jsonResult({ id: dto.id, title: dto.title, priority: dto.priority })
    },
  })

  registerTool<{ ticketId: string; content: string; fileIds?: string[] }>(server, auth, {
    name: 'reply_to_ticket',
    permissions: [PERMISSIONS.TICKET_REPLY],
    description: `Post a reply on a ticket thread (visible to the requester). On a conversation-linked customer ticket the reply lands on the pair's shared thread — the linked conversation — whose first-response machinery owns response timing; on an unlinked ticket the first reply stamps the ticket's first-response time.

Attach files already uploaded with upload_file by passing their ids in fileIds (max 10).

Example: reply_to_ticket({ ticketId: "ticket_01abc...", content: "We've issued your refund; it should arrive in 3-5 days." })`,
    schema: {
      ticketId: z.string().describe('Ticket TypeID'),
      content: z
        .string()
        .min(1)
        .max(10000)
        .describe(`Reply text, visible to the requester. ${TICKET_MARKDOWN_DESCRIBE}`),
      fileIds: z
        .array(z.string())
        .max(10)
        .optional()
        .describe('File ids from upload_file to attach to this reply (max 10)'),
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
        attachments: attachmentsFromFileIds(args.fileIds),
      })
      return jsonResult({
        id: message.id,
        ticketId: message.ticketId,
        createdAt: message.createdAt,
      })
    },
  })

  registerTool<{ ticketId: string; content: string; fileIds?: string[] }>(server, auth, {
    name: 'add_ticket_note',
    permissions: [PERMISSIONS.TICKET_NOTE],
    description: `Add an internal note to a ticket thread. Never visible to the requester — only the support team sees it.

Attach files already uploaded with upload_file by passing their ids in fileIds (max 10).

Example: add_ticket_note({ ticketId: "ticket_01abc...", content: "Confirmed the refund with billing; awaiting bank processing." })`,
    schema: {
      ticketId: z.string().describe('Ticket TypeID'),
      content: z
        .string()
        .min(1)
        .max(10000)
        .describe(`Internal note text (team-only). ${TICKET_MARKDOWN_DESCRIBE}`),
      fileIds: z
        .array(z.string())
        .max(10)
        .optional()
        .describe('File ids from upload_file to attach to this note (max 10)'),
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
        attachments: attachmentsFromFileIds(args.fileIds),
      })
      return jsonResult({
        id: message.id,
        ticketId: message.ticketId,
        createdAt: message.createdAt,
      })
    },
  })

  registerTool<{ ticketId: string; dueAt: string | null }>(server, auth, {
    name: 'set_ticket_due_date',
    permissions: [PERMISSIONS.TICKET_SET_STATUS],
    description: `Set, move, or clear (null) a ticket's due date. The customer sees the same date on their ticket; it is independent of SLA targets. Setting the date it already has changes nothing.

Examples:
- Set: set_ticket_due_date({ ticketId: "ticket_01abc...", dueAt: "2026-11-03T17:00:00Z" })
- Clear: set_ticket_due_date({ ticketId: "ticket_01abc...", dueAt: null })`,
    schema: {
      ticketId: z.string().describe('Ticket TypeID'),
      dueAt: z
        .string()
        .datetime({ offset: true })
        .nullable()
        .describe(`New due date, or null to clear it. ${TICKET_DUE_AT_DESCRIBE}`),
    },
    annotations: { ...WRITE, idempotentHint: true },
    scope: 'write:chat',
    teamOnly: true,
    handler: async (args) => {
      const { setTicketDueAt } = await import('@/lib/server/domains/tickets/ticket-due.service')
      const dto = await setTicketDueAt(
        args.ticketId as TicketId,
        args.dueAt === null ? null : new Date(args.dueAt),
        mcpAgentActor(auth)
      )
      return jsonResult({ id: dto.id, reference: dto.reference, dueAt: dto.dueAt })
    },
  })

  registerTool<{ trackerTicketId: string; ticketId: string }>(server, auth, {
    name: 'link_ticket',
    permissions: [PERMISSIONS.TICKET_ASSIGN],
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
    permissions: [PERMISSIONS.TICKET_ASSIGN],
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

  registerTool<{ ticketId: string }>(server, auth, {
    name: 'list_ticket_watchers',
    permissions: [PERMISSIONS.TICKET_VIEW],
    description: `List who watches a ticket (gets its notifications): the requester, the assignee, teammates who replied, and anyone watching by hand, with why and whether they are muted.

Example: list_ticket_watchers({ ticketId: "ticket_01abc..." })`,
    schema: { ticketId: z.string().describe('Ticket TypeID') },
    annotations: READ_ONLY,
    scope: 'read:chat',
    teamOnly: true,
    handler: async (args) => watchersResult(args.ticketId as TicketId, auth),
  })

  registerTool<{ ticketId: string }>(server, auth, {
    name: 'watch_ticket',
    permissions: [PERMISSIONS.TICKET_VIEW],
    description: `Start watching a ticket yourself, so its replies and status changes notify you. Needs a signed-in teammate (an API key has no watch of its own). Returns the ticket's watchers.

Example: watch_ticket({ ticketId: "ticket_01abc..." })`,
    schema: { ticketId: z.string().describe('Ticket TypeID') },
    annotations: WRITE,
    scope: 'write:chat',
    teamOnly: true,
    handler: async (args) => {
      requirePersonCaller(auth, 'watch a ticket')
      const { watchTicketForSelf } =
        await import('@/lib/server/domains/tickets/ticket-watchers.service')
      await watchTicketForSelf(args.ticketId as TicketId, mcpAgentActor(auth))
      return watchersResult(args.ticketId as TicketId, auth)
    },
  })

  registerTool<{ ticketId: string }>(server, auth, {
    name: 'unwatch_ticket',
    permissions: [PERMISSIONS.TICKET_VIEW],
    description: `Stop watching a ticket yourself. Needs a signed-in teammate. Returns the ticket's watchers.

Example: unwatch_ticket({ ticketId: "ticket_01abc..." })`,
    schema: { ticketId: z.string().describe('Ticket TypeID') },
    annotations: WRITE,
    scope: 'write:chat',
    teamOnly: true,
    handler: async (args) => {
      requirePersonCaller(auth, 'unwatch a ticket')
      const { unwatchTicketForSelf } =
        await import('@/lib/server/domains/tickets/ticket-watchers.service')
      await unwatchTicketForSelf(args.ticketId as TicketId, mcpAgentActor(auth))
      return watchersResult(args.ticketId as TicketId, auth)
    },
  })

  registerTool<{ ticketId: string; principalId: string }>(server, auth, {
    name: 'add_ticket_watcher',
    permissions: [PERMISSIONS.TICKET_ASSIGN],
    description: `Add a teammate as a watcher of a ticket, so its notifications reach them; they are told who added them. The teammate must be able to see the ticket (INVALID_WATCHER for someone who is not a teammate, WATCHER_CANNOT_SEE_TICKET when the ticket is hidden from them). Returns the ticket's watchers.

Example: add_ticket_watcher({ ticketId: "ticket_01abc...", principalId: "principal_01abc..." })`,
    schema: {
      ticketId: z.string().describe('Ticket TypeID'),
      principalId: z.string().describe("The teammate's principal TypeID"),
    },
    annotations: WRITE,
    scope: 'write:chat',
    teamOnly: true,
    handler: async (args) => {
      const { addTicketWatcher } =
        await import('@/lib/server/domains/tickets/ticket-watchers.service')
      await addTicketWatcher(
        args.ticketId as TicketId,
        args.principalId as PrincipalId,
        mcpAgentActor(auth)
      )
      return watchersResult(args.ticketId as TicketId, auth)
    },
  })

  registerTool<{ ticketId: string; principalId: string }>(server, auth, {
    name: 'remove_ticket_watcher',
    permissions: [PERMISSIONS.TICKET_ASSIGN],
    description: `Stop someone watching a ticket. Removing the requester also stops their status updates and resolution email. Returns the ticket's watchers.

Example: remove_ticket_watcher({ ticketId: "ticket_01abc...", principalId: "principal_01abc..." })`,
    schema: {
      ticketId: z.string().describe('Ticket TypeID'),
      principalId: z.string().describe("The watcher's principal TypeID"),
    },
    annotations: WRITE,
    scope: 'write:chat',
    teamOnly: true,
    handler: async (args) => {
      const { removeTicketWatcher } =
        await import('@/lib/server/domains/tickets/ticket-watchers.service')
      await removeTicketWatcher(
        args.ticketId as TicketId,
        args.principalId as PrincipalId,
        mcpAgentActor(auth)
      )
      return watchersResult(args.ticketId as TicketId, auth)
    },
  })

  registerTool<{ ticketId: string }>(server, auth, {
    name: 'list_ticket_participants',
    permissions: [PERMISSIONS.TICKET_VIEW],
    description: `List the customers a customer ticket is shared with, besides its requester. They read and reply on the ticket's thread from the portal and the widget, and follow it.

Example: list_ticket_participants({ ticketId: "ticket_01abc..." })`,
    schema: { ticketId: z.string().describe('Ticket TypeID') },
    annotations: READ_ONLY,
    scope: 'read:chat',
    teamOnly: true,
    handler: async (args) => participantsResult(args.ticketId as TicketId, auth),
  })

  registerTool<{ ticketId: string; email: string }>(server, auth, {
    name: 'add_ticket_participant',
    permissions: [PERMISSIONS.TICKET_REPLY],
    description: `Share a customer ticket with someone by email: they can read and reply on its thread from the portal and the widget, they follow it, and they get an email saying it was shared. Only a customer ticket with a conversation thread can be shared (TICKET_NOT_SHAREABLE), with up to 20 people. Returns the participants.

Example: add_ticket_participant({ ticketId: "ticket_01abc...", email: "grace@example.com" })`,
    schema: {
      ticketId: z.string().describe('Ticket TypeID'),
      email: z.string().email().describe("The person's email address"),
    },
    annotations: WRITE,
    scope: 'write:chat',
    teamOnly: true,
    handler: async (args) => {
      const { addTicketParticipantByEmail } =
        await import('@/lib/server/domains/tickets/ticket-sharing.service')
      await addTicketParticipantByEmail(
        args.ticketId as TicketId,
        args.email,
        mcpAgentActor(auth),
        {
          actorDisplayName: auth.name,
        }
      )
      return participantsResult(args.ticketId as TicketId, auth)
    },
  })

  registerTool<{ ticketId: string; principalId: string }>(server, auth, {
    name: 'remove_ticket_participant',
    permissions: [PERMISSIONS.TICKET_REPLY],
    description: `Stop sharing a customer ticket with someone: they lose its thread and stop following it. Returns the participants.

Example: remove_ticket_participant({ ticketId: "ticket_01abc...", principalId: "principal_01abc..." })`,
    schema: {
      ticketId: z.string().describe('Ticket TypeID'),
      principalId: z.string().describe("The participant's principal TypeID"),
    },
    annotations: WRITE,
    scope: 'write:chat',
    teamOnly: true,
    handler: async (args) => {
      const { removeTicketParticipant } =
        await import('@/lib/server/domains/tickets/ticket-sharing.service')
      await removeTicketParticipant(
        args.ticketId as TicketId,
        args.principalId as PrincipalId,
        mcpAgentActor(auth),
        { actorDisplayName: auth.name }
      )
      return participantsResult(args.ticketId as TicketId, auth)
    },
  })
}
