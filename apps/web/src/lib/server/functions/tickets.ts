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
  TicketTypeId,
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
import { validateTicketIntakeValues, coerceTicketTypeId } from '@/lib/shared/tickets'
import type {
  AssignTicketInput,
  TicketListFilter,
  TicketAssigneeFilter,
  BulkTicketAction,
} from '@/lib/server/domains/tickets'
import { requireAuth, policyActorFromAuth, assertPermission } from './auth-helpers'
import type { ConversationAttachment } from '@/lib/shared/db-types'
import { ForbiddenError, ValidationError } from '@/lib/shared/errors'
import { conversationIdSchema } from '@/lib/server/domains/assistant/conversation-id.schema'

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
  // The Phase 4 registry-type filter (the inbox tickets-branch type dropdown).
  ticketTypeId: z.string().optional(),
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
      ticketTypeId: coerceTicketTypeId(data.ticketTypeId),
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
    const { listTicketActivity } =
      await import('@/lib/server/domains/tickets/ticket-activity.service')
    return listTicketActivity(data.ticketId as TicketId)
  })

const createTicketSchema = z.object({
  // Optional since Phase 4: derivable from ticketTypeId (a mismatch is
  // rejected by the service); the column default stands when neither is given.
  type: ticketTypeSchema.optional(),
  // The Phase 4 registry type; drives the category derivation + dynamic fields.
  ticketTypeId: z.string().optional(),
  title: z.string().min(1).max(300),
  description: z.string().max(4000).optional(),
  // Empty is valid for an image/embed-only opening message; the service re-validates.
  descriptionJson: z.any().nullable().optional(),
  attachments: z.array(ticketAttachmentSchema).optional(),
  requesterPrincipalId: z.string().optional(),
  assigneePrincipalId: z.string().optional(),
  // The create-from-a-conversation flow passes the source conversation so the
  // ticket can inherit its assignee (the link itself is the separate
  // linkTicketToConversationFn step).
  conversationId: z.string().optional(),
  priority: prioritySchema.optional(),
  companyId: z.string().optional(),
  customAttributes: z.record(z.string(), z.unknown()).optional(),
})

export const createTicketFn = createServerFn({ method: 'POST' })
  .validator(createTicketSchema)
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_CREATE })
    const actor = await policyActorFromAuth(ctx)
    const ticketTypeId = coerceTicketTypeId(data.ticketTypeId)

    // Phase 4: with a registry type chosen, the field answers are validated
    // into customAttributes against the type's form — the same shared
    // validator intake runs, with internal (customer-hidden) fields included
    // because the agent dialog renders the type's full field set. Without a
    // type the legacy passthrough stands.
    let customAttributes = data.customAttributes
    if (ticketTypeId) {
      const svc = await import('@/lib/server/domains/tickets/ticket-type.service')
      const type = await svc.getTicketType(ticketTypeId)
      const result = validateTicketIntakeValues(type.fields, customAttributes ?? {}, {
        includeInternal: true,
      })
      if (!result.ok) {
        throw new ValidationError(
          'INVALID_TICKET_FIELDS',
          result.errors.map((e) => e.message).join('; ')
        )
      }
      customAttributes = Object.keys(result.values).length > 0 ? result.values : undefined
    }

    const { createTicket } = await import('@/lib/server/domains/tickets/ticket.service')
    return createTicket(
      {
        type: data.type,
        ticketTypeId,
        title: data.title,
        description: data.description,
        descriptionJson: data.descriptionJson ?? null,
        attachments: data.attachments as ConversationAttachment[] | undefined,
        requesterPrincipalId:
          data.requesterPrincipalId && isValidTypeId(data.requesterPrincipalId, 'principal')
            ? (data.requesterPrincipalId as PrincipalId)
            : undefined,
        assigneePrincipalId:
          data.assigneePrincipalId && isValidTypeId(data.assigneePrincipalId, 'principal')
            ? (data.assigneePrincipalId as PrincipalId)
            : undefined,
        sourceConversationId:
          data.conversationId && isValidTypeId(data.conversationId, 'conversation')
            ? (data.conversationId as ConversationId)
            : undefined,
        priority: data.priority,
        companyId:
          data.companyId && isValidTypeId(data.companyId, 'company')
            ? (data.companyId as CompanyId)
            : undefined,
        customAttributes,
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
    assertPermission(ctx, permissionForBulkTicketAction(data.action.type))
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
// External issue links (any tracker with the issues.parseRef capability)
// ---------------------------------------------------------------------------

/** A ticket's linked tracker issues, plus the connected trackers that support
 *  manual linking (drives the panel's per-tracker sections). Reads on
 *  TICKET_VIEW. */
export const fetchTicketExternalLinksFn = createServerFn({ method: 'GET' })
  .validator(z.object({ ticketId: z.string() }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.TICKET_VIEW })
    const { listTicketExternalLinks, listLinkableTrackers } =
      await import('@/lib/server/domains/tickets/ticket-external-links.service')
    const [links, trackers] = await Promise.all([
      listTicketExternalLinks(data.ticketId as TicketId),
      listLinkableTrackers(),
    ])
    return { links, trackers }
  })

/** Link a ticket to an existing tracker issue by URL or provider shorthand.
 *  Gated on TICKET_ASSIGN, like the tracker links. */
export const linkTicketIssueFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      ticketId: z.string(),
      issue: z.string().trim().min(1).max(500),
      integrationType: z.string().min(1).max(50).default('github'),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_ASSIGN })
    const actor = await policyActorFromAuth(ctx)
    const { linkTicketToIssue } =
      await import('@/lib/server/domains/tickets/ticket-external-links.service')
    return linkTicketToIssue(data.ticketId as TicketId, data.issue, actor, data.integrationType)
  })

/** Create a NEW issue on a connected tracker from this ticket and link it.
 *  Gated on TICKET_ASSIGN — the same association-management gate as
 *  link/unlink. Capability-gated on the provider's issues.create. */
export const createTicketIssueFn = createServerFn({ method: 'POST' })
  .validator(z.object({ ticketId: z.string(), integrationType: z.string().min(1).max(50) }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_ASSIGN })
    const actor = await policyActorFromAuth(ctx)
    const { createIssueForTicket } =
      await import('@/lib/server/domains/tickets/ticket-external-links.service')
    return createIssueForTicket(data.ticketId as TicketId, data.integrationType, actor)
  })

/** Remove a ticket's tracker issue link. Gated on TICKET_ASSIGN. */
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

/**
 * Copilot auto-fill on conversion (convergence Phase 5,
 * scratchpad/convergence-design.md): the create-ticket dialog's "✨ Auto-fill"
 * affordance. Suggests values for the chosen type's fields + the ticket title
 * from the conversation's thread — SUGGESTION-ONLY: nothing is written here,
 * the returned values pre-fill the form marked "✨ suggested", and the ticket
 * persists only through the dialog's normal submit (createTicketFn). Two
 * validation gates keep a poisoned/hallucinated suggestion from persisting:
 * the service validates the model's output against the type's field schema
 * before returning it (wholesale — never a half-filled form), and
 * createTicketFn re-validates the same values into customAttributes on save.
 *
 * Gated on ticket.create — the same permission the dialog's create path
 * requires — plus conversation viewability, since the suggestion grounds on
 * the conversation's full thread, internal notes included. Returns
 * `{ unavailable: true }` (never throws) when AI is disabled/unconfigured,
 * the budget is exhausted, the thread is empty, or the structured-output
 * completion fails: the dialog maps that to the plain Phase-4 form with a
 * quiet note. Genuine client errors (an unknown type id) still throw.
 */
export const suggestTicketFieldValuesFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      conversationId: conversationIdSchema,
      ticketTypeId: z.string().refine((v) => isValidTypeId(v, 'ticket_type'), {
        message: 'Invalid ticket type ID format',
      }),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_CREATE })
    const actor = await policyActorFromAuth(ctx)
    const conversationId = data.conversationId as ConversationId
    const { assertConversationViewable } =
      await import('@/lib/server/domains/conversation/conversation.service')
    await assertConversationViewable(conversationId, actor)
    const { suggestTicketFieldValues } =
      await import('@/lib/server/domains/assistant/ticket-field-suggestion.service')
    return suggestTicketFieldValues(conversationId, data.ticketTypeId as TicketTypeId)
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
 *  read a ticket they can actually see, matching `ticketFilter`. CONVERGENCE
 *  PHASE 2: on a linked pair this writes the CONVERSATION's agent watermark
 *  (read-through — see markTicketReadForAgent's doc). */
export const markTicketReadFn = createServerFn({ method: 'POST' })
  .validator(z.object({ ticketId: z.string() }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_VIEW })
    const actor = await policyActorFromAuth(ctx)
    const { assertTicketVisible } = await import('@/lib/server/domains/tickets/ticket.service')
    await assertTicketVisible(data.ticketId as TicketId, actor)
    const { markTicketReadForAgent } =
      await import('@/lib/server/domains/tickets/ticket-unread.service')
    await markTicketReadForAgent(data.ticketId as TicketId, actor)
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

/**
 * The workspace's requester-facing stage labels (customized via ticket
 * settings) for the portal ticket StageTracker — the same `getStageLabels()`
 * the stage chips and emails already read (B19: the tracker hardcoded the
 * DEFAULT labels while chips/emails used the customized ones). Gated only on
 * a signed-in principal: the labels are customer-visible content the
 * requester already sees on their own tickets' chips, so there is no
 * ownership dimension to enforce (unlike the agent-gated
 * `getTicketStageLabelsFn`, which reads on `ticket.view`).
 */
export const getMyTicketStageLabelsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth()
  const { getStageLabels } = await import('@/lib/server/domains/settings/settings.tickets')
  return getStageLabels()
})

export const getMyTicketThreadFn = createServerFn({ method: 'GET' })
  .validator(z.object({ ticketId: z.string(), before: z.string().optional() }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth()
    const actor = await policyActorFromAuth(ctx)
    const { getMyTicketThread } = await import('@/lib/server/domains/tickets/requester.service')
    return getMyTicketThread(actor, data.ticketId as TicketId, { before: data.before })
  })

/** The requester marks their own ticket read (opening its portal ticket page).
 *  Ownership-gated in requester.service. CONVERGENCE PHASE 2 (read-through):
 *  on a linked pair this writes the CONVERSATION's visitor watermark, so the
 *  Messages-space row + badge for the pair clear too — one shared watermark,
 *  reading either surface marks both read. */
export const markMyTicketReadFn = createServerFn({ method: 'POST' })
  .validator(z.object({ ticketId: z.string() }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth()
    const actor = await policyActorFromAuth(ctx)
    const { markMyTicketRead } = await import('@/lib/server/domains/tickets/requester.service')
    await markMyTicketRead(actor, data.ticketId as TicketId)
    return { ok: true }
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

/**
 * The portal New-Ticket form's intake shape (convergence Phase 4): the live,
 * intake-visible customer types, each carrying its customer-visible fields.
 * The dialog shows a type picker when more than one type is offered; a
 * single-type workspace behaves exactly like the legacy fixed form. Read
 * shape only — same audience as `createMyTicketFn` (any signed-in requester
 * while the support-tickets flag is on).
 */
export const getMyTicketFormFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth()
  const { isSupportTicketsEnabled } = await import('@/lib/server/domains/settings/settings.support')
  if (!(await isSupportTicketsEnabled())) {
    throw new ForbiddenError('FORBIDDEN', 'Tickets are not available')
  }
  const svc = await import('@/lib/server/domains/tickets/ticket-type-intake.service')
  const types = await svc.listIntakeTypes()
  return { types: types.map((t) => svc.ticketTypeToIntakeDTO(t)) }
})

export const createMyTicketFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      title: z.string().min(1).max(300),
      description: z.string().max(4000).optional(),
      // Empty is valid for an image/embed-only opening message; the service re-validates.
      descriptionJson: z.any().nullable().optional(),
      attachments: z.array(ticketAttachmentSchema).optional(),
      // The registry type filed under (Phase 4); absent = the customer-category
      // default type. Must be live + intake-visible (enforced server-side).
      ticketTypeId: z.string().optional(),
      // Custom intake-form answers; validated against the chosen type's form.
      fieldValues: z.record(z.string(), z.unknown()).optional(),
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
    // Resolve the type + validate the answers against its customer form (the
    // same helper the widget create runs, so portal and Messenger can't drift).
    const svc = await import('@/lib/server/domains/tickets/ticket-type-intake.service')
    const intake = await svc.resolveIntakeCreate(data.ticketTypeId, data.fieldValues)
    const { createMyTicket } = await import('@/lib/server/domains/tickets/requester.service')
    return createMyTicket(actor, {
      title: data.title,
      description: data.description,
      descriptionJson: data.descriptionJson ?? null,
      attachments: data.attachments as ConversationAttachment[] | undefined,
      ticketTypeId: intake.ticketTypeId,
      customAttributes: intake.customAttributes,
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

// ---------------------------------------------------------------------------
// Ticket watchers (subscriptions). Agent side gates on TICKET_VIEW +
// assertTicketVisible (watching is a read-side self-action — same visibility
// as reading the ticket); managing OTHER watchers gates on TICKET_ASSIGN, the
// established "manage this ticket's associations" permission. Requester side
// is ownership-gated in requester.service, mirroring the fns above.
// ---------------------------------------------------------------------------

/** The caller's principal id, or refuse — watch state is per-principal. */
function requireSelfPrincipal(actor: { principalId: PrincipalId | null }): PrincipalId {
  if (!actor.principalId) throw new ForbiddenError('FORBIDDEN', 'You must be signed in')
  return actor.principalId
}

export const getTicketWatchStatusFn = createServerFn({ method: 'GET' })
  .validator(z.object({ ticketId: z.string() }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_VIEW })
    const actor = await policyActorFromAuth(ctx)
    const { assertTicketVisible } = await import('@/lib/server/domains/tickets/ticket.service')
    await assertTicketVisible(data.ticketId as TicketId, actor)
    const { getTicketWatchStatus } =
      await import('@/lib/server/domains/tickets/ticket-subscription.service')
    return getTicketWatchStatus(requireSelfPrincipal(actor), data.ticketId as TicketId)
  })

export const watchTicketFn = createServerFn({ method: 'POST' })
  .validator(z.object({ ticketId: z.string() }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_VIEW })
    const actor = await policyActorFromAuth(ctx)
    const { assertTicketVisible } = await import('@/lib/server/domains/tickets/ticket.service')
    await assertTicketVisible(data.ticketId as TicketId, actor)
    const { subscribeToTicket } =
      await import('@/lib/server/domains/tickets/ticket-subscription.service')
    await subscribeToTicket(requireSelfPrincipal(actor), data.ticketId as TicketId, 'manual')
  })

export const unwatchTicketFn = createServerFn({ method: 'POST' })
  .validator(z.object({ ticketId: z.string() }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_VIEW })
    const actor = await policyActorFromAuth(ctx)
    const { assertTicketVisible } = await import('@/lib/server/domains/tickets/ticket.service')
    await assertTicketVisible(data.ticketId as TicketId, actor)
    const { unsubscribeFromTicket } =
      await import('@/lib/server/domains/tickets/ticket-subscription.service')
    await unsubscribeFromTicket(requireSelfPrincipal(actor), data.ticketId as TicketId)
  })

export const muteTicketFn = createServerFn({ method: 'POST' })
  .validator(z.object({ ticketId: z.string(), days: z.number().int().min(1).max(30).default(7) }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_VIEW })
    const actor = await policyActorFromAuth(ctx)
    const { assertTicketVisible } = await import('@/lib/server/domains/tickets/ticket.service')
    await assertTicketVisible(data.ticketId as TicketId, actor)
    const { muteTicket } = await import('@/lib/server/domains/tickets/ticket-subscription.service')
    const until = new Date(Date.now() + data.days * 24 * 60 * 60 * 1000)
    await muteTicket(requireSelfPrincipal(actor), data.ticketId as TicketId, until)
  })

export const unmuteTicketFn = createServerFn({ method: 'POST' })
  .validator(z.object({ ticketId: z.string() }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_VIEW })
    const actor = await policyActorFromAuth(ctx)
    const { assertTicketVisible } = await import('@/lib/server/domains/tickets/ticket.service')
    await assertTicketVisible(data.ticketId as TicketId, actor)
    const { unmuteTicket } =
      await import('@/lib/server/domains/tickets/ticket-subscription.service')
    await unmuteTicket(requireSelfPrincipal(actor), data.ticketId as TicketId)
  })

export const listTicketWatchersFn = createServerFn({ method: 'GET' })
  .validator(z.object({ ticketId: z.string() }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_VIEW })
    const actor = await policyActorFromAuth(ctx)
    const { assertTicketVisible } = await import('@/lib/server/domains/tickets/ticket.service')
    await assertTicketVisible(data.ticketId as TicketId, actor)
    const { listTicketWatchers } =
      await import('@/lib/server/domains/tickets/ticket-subscription.service')
    return listTicketWatchers(data.ticketId as TicketId)
  })

export const adminAddTicketWatcherFn = createServerFn({ method: 'POST' })
  .validator(z.object({ ticketId: z.string(), principalId: z.string() }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_ASSIGN })
    const actor = await policyActorFromAuth(ctx)
    const { assertTicketVisible } = await import('@/lib/server/domains/tickets/ticket.service')
    await assertTicketVisible(data.ticketId as TicketId, actor)
    const { addManualTicketWatcher } =
      await import('@/lib/server/domains/tickets/ticket-subscription.service')
    await addManualTicketWatcher(data.principalId as PrincipalId, data.ticketId as TicketId)
  })

export const adminRemoveTicketWatcherFn = createServerFn({ method: 'POST' })
  .validator(z.object({ ticketId: z.string(), principalId: z.string() }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_ASSIGN })
    const actor = await policyActorFromAuth(ctx)
    const { assertTicketVisible } = await import('@/lib/server/domains/tickets/ticket.service')
    await assertTicketVisible(data.ticketId as TicketId, actor)
    const { unsubscribeFromTicket } =
      await import('@/lib/server/domains/tickets/ticket-subscription.service')
    await unsubscribeFromTicket(data.principalId as PrincipalId, data.ticketId as TicketId)
  })

// Requester side (portal): ownership-gated in requester.service, flag-gated
// here like createMyTicketFn.

async function requireSupportTicketsEnabled(): Promise<void> {
  const { isSupportTicketsEnabled } = await import('@/lib/server/domains/settings/settings.support')
  if (!(await isSupportTicketsEnabled())) {
    throw new ForbiddenError('FORBIDDEN', 'Tickets are not available')
  }
}

export const getMyTicketWatchStatusFn = createServerFn({ method: 'GET' })
  .validator(z.object({ ticketId: z.string() }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth()
    await requireSupportTicketsEnabled()
    const actor = await policyActorFromAuth(ctx)
    const { getMyTicketWatchStatus } =
      await import('@/lib/server/domains/tickets/requester.service')
    return getMyTicketWatchStatus(actor, data.ticketId as TicketId)
  })

export const watchMyTicketFn = createServerFn({ method: 'POST' })
  .validator(z.object({ ticketId: z.string() }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth()
    await requireSupportTicketsEnabled()
    const actor = await policyActorFromAuth(ctx)
    const { watchMyTicket } = await import('@/lib/server/domains/tickets/requester.service')
    await watchMyTicket(actor, data.ticketId as TicketId)
  })

export const unwatchMyTicketFn = createServerFn({ method: 'POST' })
  .validator(z.object({ ticketId: z.string() }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth()
    await requireSupportTicketsEnabled()
    const actor = await policyActorFromAuth(ctx)
    const { unwatchMyTicket } = await import('@/lib/server/domains/tickets/requester.service')
    await unwatchMyTicket(actor, data.ticketId as TicketId)
  })
