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
