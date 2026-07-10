/**
 * Server functions for tickets (support platform §4.2): the agent-facing ticket
 * CRUD + lifecycle, plus the status / stage-label / intake-form management the
 * settings UI drives.
 *
 * Every function re-checks its `ticket.*` permission independently of any route
 * guard. The ticket service (dynamically imported so it never reaches the client
 * bundle) owns the business rules; these wrappers only validate input, resolve
 * the policy actor, and delegate.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { isValidTypeId } from '@quackback/ids'
import type {
  TicketId,
  TicketStatusId,
  TicketExternalLinkId,
  PrincipalId,
  TeamId,
  CompanyId,
  ConversationId,
  ConversationMessageId,
} from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  TICKET_TYPES,
  TICKET_STATUS_CATEGORIES,
  TICKET_STAGES,
  CONVERSATION_PRIORITIES,
} from '@/lib/shared/db-types'
import { ticketFormSchema, type TicketFormField } from '@/lib/shared/tickets'
import type {
  AssignTicketInput,
  TicketListFilter,
  TicketAssigneeFilter,
  BulkTicketAction,
} from '@/lib/server/domains/tickets'
import { requireAuth, policyActorFromAuth, assertPermission } from './auth-helpers'
import type { ConversationAttachment } from '@/lib/shared/db-types'
import { ForbiddenError } from '@/lib/shared/errors'

const ticketTypeSchema = z.enum(TICKET_TYPES)
const statusCategorySchema = z.enum(TICKET_STATUS_CATEGORIES)
const stageSchema = z.enum(TICKET_STAGES)
const prioritySchema = z.enum(CONVERSATION_PRIORITIES)
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid color format')

// Shared by every rich-content entry point (the opening description, a reply,
// a note): the service re-validates count/size/url, so this only shapes the
// wire payload.
const ticketAttachmentSchema = z.object({
  url: z.string(),
  name: z.string().optional(),
  contentType: z.string().optional(),
  size: z.number(),
})

// ---------------------------------------------------------------------------
// Ticket CRUD + lifecycle
// ---------------------------------------------------------------------------

const listTicketsSchema = z.object({
  type: ticketTypeSchema.optional(),
  statusCategory: statusCategorySchema.optional(),
  stage: stageSchema.optional(),
  assignee: z.string().optional(),
  teamId: z.string().optional(),
  requesterPrincipalId: z.string().optional(),
  companyId: z.string().optional(),
  search: z.string().optional(),
  sort: z.enum(['recent', 'oldest', 'created', 'priority']).optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
})

export const listTicketsFn = createServerFn({ method: 'GET' })
  .validator(listTicketsSchema)
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_VIEW })
    const actor = await policyActorFromAuth(ctx)
    const { listTickets } = await import('@/lib/server/domains/tickets/ticket.service')

    // assignee is 'me' | 'unassigned' | a teammate principal id; a junk id is
    // dropped so it can never reach the uuid-backed query.
    const assignee: TicketAssigneeFilter | undefined =
      data.assignee === 'me' || data.assignee === 'unassigned'
        ? data.assignee
        : data.assignee && isValidTypeId(data.assignee, 'principal')
          ? (data.assignee as PrincipalId)
          : undefined

    const filter: TicketListFilter = {
      type: data.type,
      statusCategory: data.statusCategory,
      stage: data.stage,
      assignee,
      teamId:
        data.teamId && isValidTypeId(data.teamId, 'team') ? (data.teamId as TeamId) : undefined,
      requesterPrincipalId:
        data.requesterPrincipalId && isValidTypeId(data.requesterPrincipalId, 'principal')
          ? (data.requesterPrincipalId as PrincipalId)
          : undefined,
      companyId:
        data.companyId && isValidTypeId(data.companyId, 'company')
          ? (data.companyId as CompanyId)
          : undefined,
      search: data.search,
      sort: data.sort,
      cursor:
        data.cursor && isValidTypeId(data.cursor, 'ticket') ? (data.cursor as TicketId) : undefined,
      limit: data.limit,
    }
    // Wire contract unchanged (bare array): `listTickets` now returns
    // `{ tickets, hasMore }`, but every current caller of this fn (the admin
    // ticket list, ticket-links picker, company activity) still expects the
    // old array shape. `hasMore` isn't surfaced here yet — pagination for this
    // surface lands with the unified inbox (§3.1), which reads `listTickets`
    // directly rather than through this fn.
    return (await listTickets(filter, actor)).tickets
  })

export const getTicketFn = createServerFn({ method: 'GET' })
  .validator(z.object({ ticketId: z.string() }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.TICKET_VIEW })
    const { getTicket } = await import('@/lib/server/domains/tickets/ticket.service')
    return getTicket(data.ticketId as TicketId)
  })

/**
 * The ticket's activity timeline (admin detail panel). Reads on TICKET_VIEW —
 * the same permission as reading the ticket — with `assertTicketVisible` as
 * the per-ticket visibility gate (unified inbox §2.5), so an agent who cannot
 * see the ticket gets NotFound, never its history.
 */
export const fetchTicketActivityFn = createServerFn({ method: 'GET' })
  .validator(z.object({ ticketId: z.string() }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_VIEW })
    const actor = await policyActorFromAuth(ctx)
    const { assertTicketVisible } = await import('@/lib/server/domains/tickets/ticket.service')
    await assertTicketVisible(data.ticketId as TicketId, actor)
    const { listTicketActivity } = await import(
      '@/lib/server/domains/tickets/ticket-activity.service'
    )
    return listTicketActivity(data.ticketId as TicketId)
  })

const createTicketSchema = z.object({
  type: ticketTypeSchema,
  title: z.string().min(1).max(300),
  description: z.string().max(4000).optional(),
  // Empty is valid for an image/embed-only opening message; the service re-validates.
  descriptionJson: z.any().nullable().optional(),
  attachments: z.array(ticketAttachmentSchema).optional(),
  requesterPrincipalId: z.string().optional(),
  priority: prioritySchema.optional(),
  companyId: z.string().optional(),
  customAttributes: z.record(z.string(), z.unknown()).optional(),
})

export const createTicketFn = createServerFn({ method: 'POST' })
  .validator(createTicketSchema)
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_CREATE })
    const actor = await policyActorFromAuth(ctx)
    const { createTicket } = await import('@/lib/server/domains/tickets/ticket.service')
    return createTicket(
      {
        type: data.type,
        title: data.title,
        description: data.description,
        descriptionJson: data.descriptionJson ?? null,
        attachments: data.attachments as ConversationAttachment[] | undefined,
        requesterPrincipalId:
          data.requesterPrincipalId && isValidTypeId(data.requesterPrincipalId, 'principal')
            ? (data.requesterPrincipalId as PrincipalId)
            : undefined,
        priority: data.priority,
        companyId:
          data.companyId && isValidTypeId(data.companyId, 'company')
            ? (data.companyId as CompanyId)
            : undefined,
        customAttributes: data.customAttributes,
      },
      actor
    )
  })

export const setTicketStatusFn = createServerFn({ method: 'POST' })
  .validator(z.object({ ticketId: z.string(), statusId: z.string() }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_SET_STATUS })
    const actor = await policyActorFromAuth(ctx)
    const { setTicketStatus } = await import('@/lib/server/domains/tickets/ticket.service')
    return setTicketStatus(data.ticketId as TicketId, data.statusId as TicketStatusId, actor)
  })

export const assignTicketFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      ticketId: z.string(),
      assigneePrincipalId: z.string().nullable().optional(),
      assigneeTeamId: z.string().nullable().optional(),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_ASSIGN })
    const actor = await policyActorFromAuth(ctx)
    const { assignTicket } = await import('@/lib/server/domains/tickets/ticket.service')

    // Preserve the null (clear) vs absent (leave as-is) distinction. 'me' resolves
    // to the caller; a malformed id is ignored so it never clears a side.
    const input: AssignTicketInput = {}
    if (data.assigneePrincipalId !== undefined) {
      if (data.assigneePrincipalId === null) input.assigneePrincipalId = null
      else if (data.assigneePrincipalId === 'me') input.assigneePrincipalId = ctx.principal.id
      else if (isValidTypeId(data.assigneePrincipalId, 'principal'))
        input.assigneePrincipalId = data.assigneePrincipalId as PrincipalId
    }
    if (data.assigneeTeamId !== undefined) {
      if (data.assigneeTeamId === null) input.assigneeTeamId = null
      else if (isValidTypeId(data.assigneeTeamId, 'team'))
        input.assigneeTeamId = data.assigneeTeamId as TeamId
    }
    return assignTicket(data.ticketId as TicketId, input, actor)
  })

export const setTicketPriorityFn = createServerFn({ method: 'POST' })
  .validator(z.object({ ticketId: z.string(), priority: prioritySchema }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_SET_STATUS })
    const actor = await policyActorFromAuth(ctx)
    const { setTicketPriority } = await import('@/lib/server/domains/tickets/ticket.service')
    return setTicketPriority(data.ticketId as TicketId, data.priority, actor)
  })

// ---------------------------------------------------------------------------
// Bulk mutation (support platform §4.6, ticket axis — mirrors
// bulkUpdateConversationsFn's contract in functions/conversation.ts)
// ---------------------------------------------------------------------------

const bulkTicketActionSchema = z.discriminatedUnion('type', [
  // assignTo: 'me' = the acting agent, a principal id, or null to unassign.
  z.object({ type: z.literal('assign'), assignTo: z.string().nullable() }),
  z.object({ type: z.literal('assign_team'), teamId: z.string().nullable() }),
  z.object({ type: z.literal('priority'), priority: prioritySchema }),
  z.object({ type: z.literal('set_status'), statusId: z.string() }),
])

/** Client-facing action shape (plain strings; the handler narrows to branded
 *  TypeIDs after validation) — what inbox callers build against. */
export type BulkTicketActionInput = z.infer<typeof bulkTicketActionSchema>

const bulkUpdateTicketsSchema = z.object({
  // Cap the batch so a single call can't fan out unbounded writes/publishes.
  ticketIds: z.array(z.string()).min(1).max(200),
  action: bulkTicketActionSchema,
})

/** Gate a bulk action on the SAME permission its single-ticket fn uses:
 *  (re)assignment mirrors assignTicketFn (ticket.assign); priority/status
 *  mirror the set-status fns — same split as the conversation bulk fn's
 *  `permissionForBulkAction`. */
function permissionForBulkTicketAction(type: BulkTicketActionInput['type']) {
  return type === 'assign' || type === 'assign_team'
    ? PERMISSIONS.TICKET_ASSIGN
    : PERMISSIONS.TICKET_SET_STATUS
}

/**
 * Apply one inbox action to many tickets in a single call (support platform
 * §4.6, ticket axis: assign, assign_team, priority, set_status). The required
 * permission depends on the action (assign vs status), so the gate is bare
 * and the per-action permission is asserted at runtime, mirroring
 * bulkUpdateConversationsFn. Unlike that fn (which loops the single-
 * conversation ops itself), the per-item loop + isolation here lives in the
 * domain-level `bulkUpdateTickets` (ticket.service.ts), which reuses the same
 * single-ticket ops (`assignTicket`/`setTicketPriority`/`setTicketStatus`)
 * their individual server fns call — this fn only resolves input ('me',
 * team-id) and delegates.
 */
export const bulkUpdateTicketsFn = createServerFn({ method: 'POST' })
  .validator(bulkUpdateTicketsSchema)
  .handler(async ({ data }) => {
    const ctx = await requireAuth()
    assertPermission(ctx.principal.role, permissionForBulkTicketAction(data.action.type))
    const actor = await policyActorFromAuth(ctx)
    const { bulkUpdateTickets } = await import('@/lib/server/domains/tickets/ticket.service')

    const action = data.action
    const resolvedAction: BulkTicketAction = (() => {
      switch (action.type) {
        case 'assign': {
          const assignTo: PrincipalId | null =
            action.assignTo === 'me'
              ? ctx.principal.id
              : ((action.assignTo as PrincipalId | null) ?? null)
          return { type: 'assign', assignTo }
        }
        case 'assign_team':
          return { type: 'assign_team', teamId: (action.teamId as TeamId | null) ?? null }
        case 'priority':
          return { type: 'priority', priority: action.priority }
        case 'set_status':
          return { type: 'set_status', statusId: action.statusId as TicketStatusId }
      }
    })()

    return bulkUpdateTickets(data.ticketIds as TicketId[], resolvedAction, actor)
  })

// ---------------------------------------------------------------------------
// Tracker links (§4.9)
// ---------------------------------------------------------------------------

/** The links for a ticket detail: a tracker's linked customer tickets, or the
 *  tracker a customer ticket belongs to. Reads on TICKET_VIEW. */
export const getTicketLinksFn = createServerFn({ method: 'GET' })
  .validator(z.object({ ticketId: z.string() }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.TICKET_VIEW })
    const { getTicket } = await import('@/lib/server/domains/tickets/ticket.service')
    const { getTrackerForTicket, listLinkedTickets } =
      await import('@/lib/server/domains/tickets/ticket-links.service')
    const ticketId = data.ticketId as TicketId
    const ticket = await getTicket(ticketId)
    if (ticket.type === 'tracker') {
      return { tracker: null, linked: await listLinkedTickets(ticketId) }
    }
    return { tracker: await getTrackerForTicket(ticketId), linked: [] }
  })

export const linkTicketToTrackerFn = createServerFn({ method: 'POST' })
  .validator(z.object({ trackerTicketId: z.string(), ticketId: z.string() }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_ASSIGN })
    const actor = await policyActorFromAuth(ctx)
    const { linkTicketToTracker } =
      await import('@/lib/server/domains/tickets/ticket-links.service')
    await linkTicketToTracker(data.trackerTicketId as TicketId, data.ticketId as TicketId, actor)
    return { success: true }
  })

export const unlinkTicketFromTrackerFn = createServerFn({ method: 'POST' })
  .validator(z.object({ trackerTicketId: z.string(), ticketId: z.string() }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_ASSIGN })
    const actor = await policyActorFromAuth(ctx)
    const { unlinkTicketFromTracker } =
      await import('@/lib/server/domains/tickets/ticket-links.service')
    await unlinkTicketFromTracker(
      data.trackerTicketId as TicketId,
      data.ticketId as TicketId,
      actor
    )
    return { success: true }
  })

// ---------------------------------------------------------------------------
// External issue links (GitHub)
// ---------------------------------------------------------------------------

/** A ticket's linked GitHub issues, plus whether the integration is connected
 *  (drives the panel's visibility). Reads on TICKET_VIEW. */
export const fetchTicketExternalLinksFn = createServerFn({ method: 'GET' })
  .validator(z.object({ ticketId: z.string() }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.TICKET_VIEW })
    const { listTicketExternalLinks, getActiveGitHubIntegration } =
      await import('@/lib/server/domains/tickets/ticket-external-links.service')
    const [links, integration] = await Promise.all([
      listTicketExternalLinks(data.ticketId as TicketId),
      getActiveGitHubIntegration(),
    ])
    return { links, githubConfigured: integration !== null }
  })

/** Link a ticket to an existing GitHub issue by URL or owner/repo#number.
 *  Gated on TICKET_ASSIGN, like the tracker links. */
export const linkTicketIssueFn = createServerFn({ method: 'POST' })
  .validator(z.object({ ticketId: z.string(), issue: z.string().trim().min(1).max(500) }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_ASSIGN })
    const actor = await policyActorFromAuth(ctx)
    const { linkTicketToIssue } =
      await import('@/lib/server/domains/tickets/ticket-external-links.service')
    return linkTicketToIssue(data.ticketId as TicketId, data.issue, actor)
  })

/** Remove a ticket's GitHub issue link. Gated on TICKET_ASSIGN. */
export const unlinkTicketIssueFn = createServerFn({ method: 'POST' })
  .validator(z.object({ ticketId: z.string(), linkId: z.string() }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_ASSIGN })
    const actor = await policyActorFromAuth(ctx)
    const { unlinkTicketIssue } =
      await import('@/lib/server/domains/tickets/ticket-external-links.service')
    await unlinkTicketIssue(data.ticketId as TicketId, data.linkId as TicketExternalLinkId, actor)
    return { success: true }
  })

/**
 * Link a freshly created customer ticket back to the conversation it came
 * from (unified inbox §M5's create-ticket flow, step 2 after createTicketFn).
 * Gated on ticket.create — same permission the create step itself required.
 */
export const linkTicketToConversationFn = createServerFn({ method: 'POST' })
  .validator(z.object({ ticketId: z.string(), conversationId: z.string() }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_CREATE })
    const actor = await policyActorFromAuth(ctx)
    const { linkTicketToConversation } =
      await import('@/lib/server/domains/tickets/ticket-conversation-link.service')
    await linkTicketToConversation(
      data.ticketId as TicketId,
      data.conversationId as ConversationId,
      actor
    )
    return { success: true }
  })

// ---------------------------------------------------------------------------
// Status management (settings UI)
// ---------------------------------------------------------------------------

/** Agents need the status list to set a ticket's status, so this reads on TICKET_VIEW. */
export const listTicketStatusesFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.TICKET_VIEW })
  const { listTicketStatuses } = await import('@/lib/server/domains/tickets/ticket-status.service')
  return listTicketStatuses()
})

export const createTicketStatusFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      name: z.string().min(1).max(50),
      color: hexColor,
      category: statusCategorySchema,
      publicStage: stageSchema.nullable().optional(),
    })
  )
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.TICKET_MANAGE_TYPES })
    const { createTicketStatus } =
      await import('@/lib/server/domains/tickets/ticket-status.service')
    return createTicketStatus(data)
  })

export const updateTicketStatusFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string(),
      name: z.string().min(1).max(50).optional(),
      color: hexColor.optional(),
      category: statusCategorySchema.optional(),
      publicStage: stageSchema.nullable().optional(),
      position: z.number().int().optional(),
    })
  )
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.TICKET_MANAGE_TYPES })
    const { updateTicketStatusEntity } =
      await import('@/lib/server/domains/tickets/ticket-status.service')
    const { id, ...patch } = data
    return updateTicketStatusEntity(id as TicketStatusId, patch)
  })

export const reorderTicketStatusesFn = createServerFn({ method: 'POST' })
  .validator(z.object({ orderedIds: z.array(z.string()).min(1) }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.TICKET_MANAGE_TYPES })
    const { reorderTicketStatuses } =
      await import('@/lib/server/domains/tickets/ticket-status.service')
    await reorderTicketStatuses(data.orderedIds as TicketStatusId[])
    return { ok: true }
  })

export const deleteTicketStatusFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.TICKET_MANAGE_TYPES })
    const { softDeleteTicketStatus } =
      await import('@/lib/server/domains/tickets/ticket-status.service')
    await softDeleteTicketStatus(data.id as TicketStatusId)
    return { ok: true }
  })

// ---------------------------------------------------------------------------
// Stage labels + intake forms (settings UI)
// ---------------------------------------------------------------------------

export const getTicketStageLabelsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.TICKET_VIEW })
  const { getStageLabels } = await import('@/lib/server/domains/settings/settings.tickets')
  return getStageLabels()
})

export const setTicketStageLabelsFn = createServerFn({ method: 'POST' })
  .validator(
    z
      .object({
        received: z.string().trim().min(1).max(60),
        in_progress: z.string().trim().min(1).max(60),
        awaiting_requester: z.string().trim().min(1).max(60),
        resolved: z.string().trim().min(1).max(60),
      })
      .partial()
  )
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.TICKET_MANAGE_TYPES })
    const { setStageLabels } = await import('@/lib/server/domains/settings/settings.tickets')
    return setStageLabels(data)
  })

export const getTicketFormsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.TICKET_VIEW })
  const { getTicketForms } = await import('@/lib/server/domains/settings/settings.tickets')
  return getTicketForms()
})

export const setTicketFormFn = createServerFn({ method: 'POST' })
  .validator(z.object({ type: ticketTypeSchema, fields: ticketFormSchema }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.TICKET_MANAGE_TYPES })
    const { setTicketForm } = await import('@/lib/server/domains/settings/settings.tickets')
    return setTicketForm(data.type, data.fields as TicketFormField[])
  })

// ---------------------------------------------------------------------------
// Ticket thread messages (§4.2)
// ---------------------------------------------------------------------------

const sendTicketMessageSchema = z.object({
  ticketId: z.string(),
  // Empty is valid for an image/embed-only rich message; the service re-validates.
  content: z.string().default(''),
  contentJson: z.any().nullable().optional(),
  attachments: z.array(ticketAttachmentSchema).optional(),
})

export const sendTicketMessageFn = createServerFn({ method: 'POST' })
  .validator(sendTicketMessageSchema)
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_REPLY })
    const actor = await policyActorFromAuth(ctx)
    const { sendTicketMessage } =
      await import('@/lib/server/domains/tickets/ticket-message.service')
    return sendTicketMessage(actor, {
      ticketId: data.ticketId as TicketId,
      content: data.content,
      contentJson: data.contentJson ?? null,
      attachments: data.attachments as ConversationAttachment[] | undefined,
    })
  })

export const addTicketNoteFn = createServerFn({ method: 'POST' })
  .validator(sendTicketMessageSchema)
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_NOTE })
    const actor = await policyActorFromAuth(ctx)
    const { addTicketNote } = await import('@/lib/server/domains/tickets/ticket-message.service')
    return addTicketNote(actor, {
      ticketId: data.ticketId as TicketId,
      content: data.content,
      contentJson: data.contentJson ?? null,
      attachments: data.attachments as ConversationAttachment[] | undefined,
    })
  })

export const listTicketMessagesFn = createServerFn({ method: 'GET' })
  .validator(z.object({ ticketId: z.string(), before: z.string().optional() }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_VIEW })
    const { isTeamMember } = await import('@/lib/shared/roles')
    const isAgent = isTeamMember(ctx.principal.role)
    const { listTicketMessages, listTicketMessagesForAgent } =
      await import('@/lib/server/domains/tickets/ticket-message.service')
    // Agents get the enriched (reactions/flags) page — the toolbar these
    // drive is agent-only; a non-agent caller (a customer viewing their own
    // ticket via this same TICKET_VIEW-gated fn) keeps the bare shape.
    if (isAgent) {
      return listTicketMessagesForAgent(
        data.ticketId as TicketId,
        ctx.principal.id as PrincipalId,
        {
          before: data.before,
          includeInternal: true,
        }
      )
    }
    return listTicketMessages(data.ticketId as TicketId, {
      before: data.before,
      includeInternal: false,
    })
  })

const markTicketUnreadFromMessageSchema = z.object({
  ticketId: z.string(),
  messageId: z.string(),
})

/** Agent action: mark a ticket unread starting at a specific message ("mark
 *  unread from here"), the ticket-thread sibling of
 *  `markConversationUnreadFromMessageFn` (unified inbox §2.5). Ticket
 *  visibility is enforced inside `markTicketUnreadFromMessage` itself. */
export const markTicketUnreadFromMessageFn = createServerFn({ method: 'POST' })
  .validator(markTicketUnreadFromMessageSchema)
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_VIEW })
    const actor = await policyActorFromAuth(ctx)
    const { markTicketUnreadFromMessage } =
      await import('@/lib/server/domains/tickets/ticket-unread.service')
    await markTicketUnreadFromMessage(
      data.ticketId as TicketId,
      data.messageId as ConversationMessageId,
      actor
    )
    return { ok: true }
  })

/** Agent action: mark a ticket read (opening/viewing its thread) — distinct
 *  from `markTicketUnreadFromMessageFn` above, and with no prior server fn at
 *  all. Ticket-visibility-gated so a `ticket.view`-holding agent can only mark
 *  read a ticket they can actually see, matching `ticketFilter`. */
export const markTicketReadFn = createServerFn({ method: 'POST' })
  .validator(z.object({ ticketId: z.string() }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_VIEW })
    const actor = await policyActorFromAuth(ctx)
    const { assertTicketVisible } = await import('@/lib/server/domains/tickets/ticket.service')
    await assertTicketVisible(data.ticketId as TicketId, actor)
    const { markTicketReadForAgent } =
      await import('@/lib/server/domains/tickets/ticket-unread.service')
    await markTicketReadForAgent(data.ticketId as TicketId)
    return { ok: true }
  })

/**
 * Export a ticket as a markdown transcript (agent-only — includes internal
 * notes). Pages the full thread oldest-first and renders it with the shared
 * transcript renderer. Returns the file body for the client to download.
 */
export const exportTicketTranscriptFn = createServerFn({ method: 'GET' })
  .validator(z.object({ ticketId: z.string() }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_VIEW })
    const { isTeamMember } = await import('@/lib/shared/roles')
    if (!isTeamMember(ctx.principal.role)) {
      throw new ForbiddenError('FORBIDDEN', 'Only team members can export a transcript')
    }
    const ticketId = data.ticketId as TicketId
    const { getTicket } = await import('@/lib/server/domains/tickets/ticket.service')
    const ticket = await getTicket(ticketId)
    const { listTicketMessages } =
      await import('@/lib/server/domains/tickets/ticket-message.service')

    // Assemble the full thread oldest-first. listTicketMessages carries no
    // nextCursor, so the oldest message of each (oldest-first) page is the
    // before-cursor for the next, older page. Bounded loop.
    const all: Awaited<ReturnType<typeof listTicketMessages>>['messages'] = []
    let before: string | undefined
    for (let i = 0; i < 500; i++) {
      const page = await listTicketMessages(ticketId, { includeInternal: true, before })
      all.unshift(...page.messages)
      if (!page.hasMore || page.messages.length === 0) break
      before = page.messages[0].id
    }

    const { renderConversationTranscript } =
      await import('@/lib/server/domains/conversation/conversation.transcript')
    const content = renderConversationTranscript(
      {
        id: ticketId,
        heading: `Ticket ${ticket.reference}`,
        subject: ticket.title,
        status: ticket.status.name,
        createdAt: ticket.createdAt,
      },
      all
    )
    return { filename: `ticket-${ticket.number}.md`, content, mimeType: 'text/markdown' }
  })

// ---------------------------------------------------------------------------
// Requester-facing (portal) — a customer reads + replies on their OWN customer
// tickets. No `ticket.*` permission: the domain gates on ownership. Any signed-in
// user may call these; they only ever reach tickets they filed.
// ---------------------------------------------------------------------------

export const listMyTicketsFn = createServerFn({ method: 'GET' }).handler(async () => {
  const ctx = await requireAuth()
  const actor = await policyActorFromAuth(ctx)
  const { listMyTickets } = await import('@/lib/server/domains/tickets/requester.service')
  return listMyTickets(actor)
})

export const getMyTicketFn = createServerFn({ method: 'GET' })
  .validator(z.object({ ticketId: z.string() }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth()
    const actor = await policyActorFromAuth(ctx)
    const { getMyTicket } = await import('@/lib/server/domains/tickets/requester.service')
    return getMyTicket(actor, data.ticketId as TicketId)
  })

export const getMyTicketThreadFn = createServerFn({ method: 'GET' })
  .validator(z.object({ ticketId: z.string(), before: z.string().optional() }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth()
    const actor = await policyActorFromAuth(ctx)
    const { getMyTicketThread } = await import('@/lib/server/domains/tickets/requester.service')
    return getMyTicketThread(actor, data.ticketId as TicketId, { before: data.before })
  })

export const replyToMyTicketFn = createServerFn({ method: 'POST' })
  .validator(sendTicketMessageSchema)
  .handler(async ({ data }) => {
    const ctx = await requireAuth()
    const actor = await policyActorFromAuth(ctx)
    const { replyToMyTicket } = await import('@/lib/server/domains/tickets/requester.service')
    return replyToMyTicket(actor, {
      ticketId: data.ticketId as TicketId,
      content: data.content,
      contentJson: data.contentJson ?? null,
      attachments: data.attachments as ConversationAttachment[] | undefined,
    })
  })

export const createMyTicketFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      title: z.string().min(1).max(300),
      description: z.string().max(4000).optional(),
      // Empty is valid for an image/embed-only opening message; the service re-validates.
      descriptionJson: z.any().nullable().optional(),
      attachments: z.array(ticketAttachmentSchema).optional(),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requireAuth()
    // Self-creation is opt-in: gate on the support-tickets flag being enabled.
    const { isSupportTicketsEnabled } =
      await import('@/lib/server/domains/settings/settings.support')
    if (!(await isSupportTicketsEnabled())) {
      throw new ForbiddenError('FORBIDDEN', 'Ticket creation is not available')
    }
    const actor = await policyActorFromAuth(ctx)
    const { createMyTicket } = await import('@/lib/server/domains/tickets/requester.service')
    return createMyTicket(actor, {
      title: data.title,
      description: data.description,
      descriptionJson: data.descriptionJson ?? null,
      attachments: data.attachments as ConversationAttachment[] | undefined,
    })
  })

const searchSchema = z.object({
  query: z.string(),
  limit: z.number().int().min(1).max(50).optional(),
})

/** Admin ticket search (agent audience, scoped by ticketFilter). */
export const searchTicketsFn = createServerFn({ method: 'GET' })
  .validator(searchSchema)
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_VIEW })
    const actor = await policyActorFromAuth(ctx)
    const { searchTickets } = await import('@/lib/server/domains/tickets/ticket-search.service')
    return searchTickets(actor, { query: data.query, audience: 'agent', limit: data.limit })
  })

/** Portal ticket search (requester audience: own customer tickets, no internals). */
export const searchMyTicketsFn = createServerFn({ method: 'GET' })
  .validator(searchSchema)
  .handler(async ({ data }) => {
    const ctx = await requireAuth()
    const actor = await policyActorFromAuth(ctx)
    const { searchTickets } = await import('@/lib/server/domains/tickets/ticket-search.service')
    return searchTickets(actor, { query: data.query, audience: 'requester', limit: data.limit })
  })
