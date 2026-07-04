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
import type { TicketId, TicketStatusId, PrincipalId, TeamId, CompanyId } from '@quackback/ids'
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
} from '@/lib/server/domains/tickets'
import { requireAuth, policyActorFromAuth } from './auth-helpers'
import type { ConversationAttachment } from '@/lib/shared/db-types'
import { ForbiddenError } from '@/lib/shared/errors'

const ticketTypeSchema = z.enum(TICKET_TYPES)
const statusCategorySchema = z.enum(TICKET_STATUS_CATEGORIES)
const stageSchema = z.enum(TICKET_STAGES)
const prioritySchema = z.enum(CONVERSATION_PRIORITIES)
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid color format')

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
  sort: z.enum(['recent', 'oldest', 'created', 'priority']).optional(),
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
      sort: data.sort,
      limit: data.limit,
    }
    return listTickets(filter, actor)
  })

export const getTicketFn = createServerFn({ method: 'GET' })
  .validator(z.object({ ticketId: z.string() }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.TICKET_VIEW })
    const { getTicket } = await import('@/lib/server/domains/tickets/ticket.service')
    return getTicket(data.ticketId as TicketId)
  })

const createTicketSchema = z.object({
  type: ticketTypeSchema,
  title: z.string().min(1).max(300),
  description: z.string().max(4000).optional(),
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

const ticketAttachmentSchema = z.object({
  url: z.string(),
  name: z.string().optional(),
  contentType: z.string().optional(),
  size: z.number(),
})

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
    const { listTicketMessages } =
      await import('@/lib/server/domains/tickets/ticket-message.service')
    return listTicketMessages(data.ticketId as TicketId, {
      before: data.before,
      includeInternal: isTeamMember(ctx.principal.role),
    })
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
    z.object({ title: z.string().min(1).max(300), description: z.string().max(4000).optional() })
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
    return createMyTicket(actor, { title: data.title, description: data.description })
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
