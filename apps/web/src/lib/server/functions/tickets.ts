/**
 * Tickets server functions.
 *
 * Each handler:
 *   1. Loads the actor's PermissionSet (via `requireAuthWithPermissions` or
 *      `requirePermission`).
 *   2. For per-ticket actions, loads the ticket and converts it to a
 *      ResourceScope so team-scoped grants are evaluated correctly.
 *   3. Delegates to the domain service, which writes the activity row +
 *      audit event itself.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type {
  TicketId,
  TicketStatusId,
  TicketThreadId,
  TicketShareId,
  TicketParticipantId,
  PrincipalId,
  TeamId,
  ContactId,
  OrganizationId,
} from '@quackback/ids'
import { requireAuthWithPermissions, requirePermission } from './auth-helpers'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { ForbiddenError, NotFoundError } from '@/lib/shared/errors'
import {
  TICKET_PRIORITIES,
  TICKET_CHANNELS,
  TICKET_VISIBILITY_SCOPES,
  TICKET_THREAD_AUDIENCES,
  TICKET_SHARE_LEVELS,
  TICKET_PARTICIPANT_ROLES,
} from '@/lib/server/db'
import {
  createTicket,
  getTicket,
  updateTicket,
  assignTicket,
  transitionStatus,
  softDeleteTicket,
  addThread,
  listThreads,
  shareTicketWithTeam,
  revokeShare,
  listSharesForTicket,
  addParticipant,
  removeParticipant,
  listParticipants,
  listTickets,
  toResourceScope,
  canViewTicket,
  canReplyPublic,
  canCommentInternal,
  canEditFields,
  canAssign,
  canShareCrossTeam,
  canManageParticipants,
  takeTicket,
  returnTicket,
  bulkAssign,
  bulkTransition,
  bulkChangeInbox,
  type TicketQueueScope,
} from '@/lib/server/domains/tickets'
import { listTicketStatuses } from '@/lib/server/domains/tickets/ticket-statuses.service'
import { hasPermissionForResource } from '@/lib/server/domains/authz/authz.service'
import type { InboxId } from '@quackback/ids'
import { db, ticketActivity, principal, eq, and, lt, desc } from '@/lib/server/db'
import type { AuditJsonValue } from '@/lib/shared/db-types'

// ---------- shared schemas ----------

const ticketIdSchema = z.string().min(1) as z.ZodType<TicketId>
const ticketStatusIdSchema = z.string().min(1) as z.ZodType<TicketStatusId>
const _ticketThreadIdSchema = z.string().min(1) as z.ZodType<TicketThreadId>
const ticketShareIdSchema = z.string().min(1) as z.ZodType<TicketShareId>
const ticketParticipantIdSchema = z.string().min(1) as z.ZodType<TicketParticipantId>
const principalIdSchema = z.string().min(1) as z.ZodType<PrincipalId>
const teamIdSchema = z.string().min(1) as z.ZodType<TeamId>
const contactIdSchema = z.string().min(1) as z.ZodType<ContactId>
const orgIdSchema = z.string().min(1) as z.ZodType<OrganizationId>
const isoDate = z.string().datetime()

const tiptapDocSchema = z
  .object({ type: z.literal('doc'), content: z.array(z.unknown()).optional() })
  .passthrough()

// ---------- queue ----------

export const listTicketsFn = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      scope: z.enum([
        'all',
        'my_assigned',
        'my_team',
        'shared_with_me',
        'unassigned',
        'my_inbox',
        'inbox',
      ]),
      statusCategory: z.enum(['open', 'pending', 'on_hold', 'solved', 'closed']).optional(),
      search: z.string().max(200).optional(),
      inboxId: z.string().min(1).nullable().optional(),
      organizationId: orgIdSchema.nullable().optional(),
      requesterContactId: contactIdSchema.nullable().optional(),
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).optional(),
      sort: z.enum(['last_activity_desc', 'created_desc', 'created_asc']).optional(),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requireAuthWithPermissions()
    return listTickets({
      scope: data.scope as TicketQueueScope,
      permissionSet: ctx.permissions,
      statusCategory: data.statusCategory,
      search: data.search,
      inboxId: (data.inboxId ?? undefined) as never,
      organizationId: data.organizationId ?? undefined,
      requesterContactId: data.requesterContactId ?? undefined,
      limit: data.limit,
      offset: data.offset,
      sort: data.sort,
    })
  })

// ---------- create / read ----------

export const createTicketFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      subject: z.string().min(1).max(500),
      descriptionJson: tiptapDocSchema.nullable().optional(),
      descriptionText: z.string().max(100_000).nullable().optional(),
      priority: z.enum(TICKET_PRIORITIES).optional(),
      channel: z.enum(TICKET_CHANNELS).optional(),
      visibilityScope: z.enum(TICKET_VISIBILITY_SCOPES).optional(),
      statusId: ticketStatusIdSchema.nullable().optional(),
      primaryTeamId: teamIdSchema.nullable().optional(),
      assigneePrincipalId: principalIdSchema.nullable().optional(),
      assigneeTeamId: teamIdSchema.nullable().optional(),
      requesterContactId: contactIdSchema.nullable().optional(),
      organizationId: orgIdSchema.nullable().optional(),
      inboxId: (z.string().min(1) as z.ZodType<InboxId>).nullable().optional(),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.TICKET_EDIT_FIELDS)
    return createTicket({
      ...data,
      descriptionJson: (data.descriptionJson ?? null) as never,
      createdByPrincipalId: ctx.principal.id,
      requesterPrincipalId: ctx.principal.id,
    })
  })

export const getTicketFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ ticketId: ticketIdSchema }))
  .handler(async ({ data }) => {
    const ctx = await requireAuthWithPermissions()
    const ticket = await getTicket(data.ticketId)
    if (!ticket) throw new NotFoundError('TICKET_NOT_FOUND', `ticket ${data.ticketId} not found`)
    const shares = await listSharesForTicket(data.ticketId)
    const scope = toResourceScope({
      primaryTeamId: ticket.primaryTeamId as TeamId | null,
      assigneePrincipalId: ticket.assigneePrincipalId as PrincipalId | null,
      assigneeTeamId: ticket.assigneeTeamId as TeamId | null,
      shares: shares.map((s) => ({ teamId: s.teamId as TeamId, revokedAt: s.revokedAt })),
    })
    if (!canViewTicket(ctx.permissions, scope)) {
      throw new ForbiddenError('TICKET_VIEW_DENIED', 'cannot view this ticket')
    }
    return ticket
  })

// ---------- update ----------

export const updateTicketFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      ticketId: ticketIdSchema,
      expectedUpdatedAt: isoDate,
      subject: z.string().min(1).max(500).optional(),
      descriptionJson: tiptapDocSchema.nullable().optional(),
      descriptionText: z.string().max(100_000).nullable().optional(),
      priority: z.enum(TICKET_PRIORITIES).optional(),
      visibilityScope: z.enum(TICKET_VISIBILITY_SCOPES).optional(),
      primaryTeamId: teamIdSchema.nullable().optional(),
      organizationId: orgIdSchema.nullable().optional(),
      requesterContactId: contactIdSchema.nullable().optional(),
      inboxId: (z.string().min(1) as z.ZodType<InboxId>).nullable().optional(),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requireAuthWithPermissions()
    const scope = await loadScope(data.ticketId)
    if (!canEditFields(ctx.permissions, scope)) {
      throw new ForbiddenError('TICKET_EDIT_DENIED', 'cannot edit this ticket')
    }
    return updateTicket(data.ticketId, {
      ...data,
      descriptionJson: data.descriptionJson as never,
      expectedUpdatedAt: new Date(data.expectedUpdatedAt),
      actorPrincipalId: ctx.principal.id,
    })
  })

// ---------- assign ----------

export const assignTicketFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      ticketId: ticketIdSchema,
      expectedUpdatedAt: isoDate,
      assigneePrincipalId: principalIdSchema.nullable().optional(),
      assigneeTeamId: teamIdSchema.nullable().optional(),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requireAuthWithPermissions()
    const scope = await loadScope(data.ticketId)
    const isSelf = data.assigneePrincipalId != null && data.assigneePrincipalId === ctx.principal.id
    const allowed = isSelf
      ? canAssign(ctx.permissions, scope) ||
        // self-assignment fallback
        (await import('@/lib/server/domains/tickets')).canAssignSelf(ctx.permissions, scope)
      : canAssign(ctx.permissions, scope)
    if (!allowed) {
      throw new ForbiddenError('TICKET_ASSIGN_DENIED', 'cannot assign this ticket')
    }
    return assignTicket(data.ticketId, {
      expectedUpdatedAt: new Date(data.expectedUpdatedAt),
      actorPrincipalId: ctx.principal.id,
      assigneePrincipalId: data.assigneePrincipalId ?? null,
      assigneeTeamId: data.assigneeTeamId ?? null,
    })
  })

// ---------- status transition ----------

export const transitionTicketStatusFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      ticketId: ticketIdSchema,
      expectedUpdatedAt: isoDate,
      statusId: ticketStatusIdSchema,
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requireAuthWithPermissions()
    const scope = await loadScope(data.ticketId)
    if (!canEditFields(ctx.permissions, scope)) {
      throw new ForbiddenError('TICKET_TRANSITION_DENIED', 'cannot transition this ticket')
    }
    return transitionStatus(data.ticketId, {
      expectedUpdatedAt: new Date(data.expectedUpdatedAt),
      actorPrincipalId: ctx.principal.id,
      statusId: data.statusId,
    })
  })

// ---------- soft delete ----------

export const softDeleteTicketFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ ticketId: ticketIdSchema }))
  .handler(async ({ data }) => {
    const ctx = await requireAuthWithPermissions()
    const scope = await loadScope(data.ticketId)
    if (!canEditFields(ctx.permissions, scope)) {
      throw new ForbiddenError('TICKET_DELETE_DENIED', 'cannot delete this ticket')
    }
    return softDeleteTicket(data.ticketId, ctx.principal.id)
  })

// ---------- threads ----------

export const addThreadFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      ticketId: ticketIdSchema,
      audience: z.enum(TICKET_THREAD_AUDIENCES),
      bodyJson: tiptapDocSchema.nullable().optional(),
      bodyText: z.string().max(100_000).nullable().optional(),
      sharedWithTeamId: teamIdSchema.nullable().optional(),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requireAuthWithPermissions()
    const scope = await loadScope(data.ticketId)
    if (data.audience === 'public') {
      if (!canReplyPublic(ctx.permissions, scope)) {
        throw new ForbiddenError('TICKET_REPLY_DENIED', 'cannot reply publicly')
      }
    } else if (data.audience === 'internal') {
      if (!canCommentInternal(ctx.permissions, scope)) {
        throw new ForbiddenError('TICKET_COMMENT_DENIED', 'cannot post internal comments')
      }
    } else if (data.audience === 'shared_team') {
      if (!canShareCrossTeam(ctx.permissions, scope)) {
        throw new ForbiddenError('TICKET_SHARED_NOTE_DENIED', 'cannot post shared-team threads')
      }
    }
    return addThread({
      ticketId: data.ticketId,
      principalId: ctx.principal.id,
      audience: data.audience,
      bodyJson: (data.bodyJson ?? null) as never,
      bodyText: data.bodyText ?? null,
      sharedWithTeamId: data.sharedWithTeamId ?? null,
    })
  })

export const listThreadsFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ ticketId: ticketIdSchema }))
  .handler(async ({ data }) => {
    const ctx = await requireAuthWithPermissions()
    const scope = await loadScope(data.ticketId)
    if (!canViewTicket(ctx.permissions, scope)) {
      throw new ForbiddenError('TICKET_VIEW_DENIED', 'cannot view this ticket')
    }
    const ticket = await getTicket(data.ticketId)
    return listThreads(data.ticketId, {
      viewerTeamIds: ctx.permissions.teamIds,
      canSeeInternal: canCommentInternal(ctx.permissions, scope),
      isRequester: ticket?.requesterPrincipalId === ctx.principal.id,
    })
  })

// ---------- shares ----------

export const shareTicketFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      ticketId: ticketIdSchema,
      teamId: teamIdSchema,
      accessLevel: z.enum(TICKET_SHARE_LEVELS).optional(),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requireAuthWithPermissions()
    const scope = await loadScope(data.ticketId)
    if (!canShareCrossTeam(ctx.permissions, scope)) {
      throw new ForbiddenError('TICKET_SHARE_DENIED', 'cannot share this ticket')
    }
    return shareTicketWithTeam({
      ticketId: data.ticketId,
      teamId: data.teamId,
      accessLevel: data.accessLevel,
      grantedByPrincipalId: ctx.principal.id,
    })
  })

export const revokeShareFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ shareId: ticketShareIdSchema }))
  .handler(async ({ data }) => {
    const ctx = await requireAuthWithPermissions()
    return revokeShare(data.shareId, ctx.principal.id)
  })

export const listSharesFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ ticketId: ticketIdSchema }))
  .handler(async ({ data }) => {
    const ctx = await requireAuthWithPermissions()
    const scope = await loadScope(data.ticketId)
    if (!canViewTicket(ctx.permissions, scope)) {
      throw new ForbiddenError('TICKET_VIEW_DENIED', 'cannot view this ticket')
    }
    return listSharesForTicket(data.ticketId)
  })

// ---------- participants ----------

export const addParticipantFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      ticketId: ticketIdSchema,
      role: z.enum(TICKET_PARTICIPANT_ROLES),
      principalId: principalIdSchema.nullable().optional(),
      contactId: contactIdSchema.nullable().optional(),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requireAuthWithPermissions()
    const scope = await loadScope(data.ticketId)
    if (!canManageParticipants(ctx.permissions, scope)) {
      throw new ForbiddenError(
        'TICKET_PARTICIPANT_DENIED',
        'cannot manage participants on this ticket'
      )
    }
    return addParticipant({
      ticketId: data.ticketId,
      role: data.role,
      principalId: data.principalId ?? null,
      contactId: data.contactId ?? null,
      addedByPrincipalId: ctx.principal.id,
    })
  })

export const removeParticipantFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      ticketId: ticketIdSchema,
      participantId: ticketParticipantIdSchema,
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requireAuthWithPermissions()
    const scope = await loadScope(data.ticketId)
    if (!canManageParticipants(ctx.permissions, scope)) {
      throw new ForbiddenError(
        'TICKET_PARTICIPANT_DENIED',
        'cannot manage participants on this ticket'
      )
    }
    await removeParticipant(data.participantId, ctx.principal.id)
    return { ok: true as const }
  })

export const listParticipantsFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ ticketId: ticketIdSchema }))
  .handler(async ({ data }) => {
    const ctx = await requireAuthWithPermissions()
    const scope = await loadScope(data.ticketId)
    if (!canViewTicket(ctx.permissions, scope)) {
      throw new ForbiddenError('TICKET_VIEW_DENIED', 'cannot view this ticket')
    }
    return listParticipants(data.ticketId)
  })

// ---------- helpers ----------

async function loadScope(ticketId: TicketId) {
  const ticket = await getTicket(ticketId)
  if (!ticket) throw new NotFoundError('TICKET_NOT_FOUND', `ticket ${ticketId} not found`)
  const shares = await listSharesForTicket(ticketId)
  return toResourceScope({
    primaryTeamId: ticket.primaryTeamId as TeamId | null,
    assigneePrincipalId: ticket.assigneePrincipalId as PrincipalId | null,
    assigneeTeamId: ticket.assigneeTeamId as TeamId | null,
    shares: shares.map((s) => ({ teamId: s.teamId as TeamId, revokedAt: s.revokedAt })),
  })
}

// ---------- take / return ----------

export const takeTicketFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ ticketId: ticketIdSchema }))
  .handler(async ({ data }) => {
    const ctx = await requireAuthWithPermissions()
    const scope = await loadScope(data.ticketId)
    if (!hasPermissionForResource(ctx.permissions, PERMISSIONS.TICKET_ASSIGN_SELF, scope)) {
      throw new ForbiddenError('TICKET_ASSIGN_DENIED', 'ticket.assign_self required')
    }
    return takeTicket(data.ticketId, ctx.principal.id as PrincipalId)
  })

export const returnTicketFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ ticketId: ticketIdSchema }))
  .handler(async ({ data }) => {
    const ctx = await requireAuthWithPermissions()
    const scope = await loadScope(data.ticketId)
    const allowed =
      hasPermissionForResource(ctx.permissions, PERMISSIONS.TICKET_ASSIGN_ANY, scope) ||
      hasPermissionForResource(ctx.permissions, PERMISSIONS.TICKET_ASSIGN_SELF, scope)
    if (!allowed) throw new ForbiddenError('TICKET_RETURN_DENIED', 'cannot return this ticket')
    return returnTicket(data.ticketId, ctx.principal.id as PrincipalId)
  })

// ---------- bulk ops ----------

const ticketIdsSchema = z.array(ticketIdSchema).min(1).max(500)

export const bulkAssignTicketsFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      ticketIds: ticketIdsSchema,
      assigneePrincipalId: principalIdSchema.nullable().optional(),
      assigneeTeamId: teamIdSchema.nullable().optional(),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.TICKET_BULK_OPERATE)
    return bulkAssign({
      ticketIds: data.ticketIds,
      actorPrincipalId: ctx.principal.id as PrincipalId,
      assigneePrincipalId: data.assigneePrincipalId ?? undefined,
      assigneeTeamId: data.assigneeTeamId ?? undefined,
      permit: (scope) =>
        hasPermissionForResource(ctx.permissions, PERMISSIONS.TICKET_ASSIGN_ANY, scope),
    })
  })

export const bulkTransitionTicketsFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      ticketIds: ticketIdsSchema,
      statusId: ticketStatusIdSchema,
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.TICKET_BULK_OPERATE)
    return bulkTransition({
      ticketIds: data.ticketIds,
      actorPrincipalId: ctx.principal.id as PrincipalId,
      statusId: data.statusId,
      permit: (scope) =>
        hasPermissionForResource(ctx.permissions, PERMISSIONS.TICKET_EDIT_FIELDS, scope),
    })
  })

export const bulkChangeInboxFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      ticketIds: ticketIdsSchema,
      inboxId: z.string().min(1).nullable(),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.TICKET_BULK_OPERATE)
    return bulkChangeInbox({
      ticketIds: data.ticketIds,
      actorPrincipalId: ctx.principal.id as PrincipalId,
      inboxId: data.inboxId as InboxId | null,
      permit: (scope) =>
        hasPermissionForResource(ctx.permissions, PERMISSIONS.TICKET_EDIT_FIELDS, scope),
    })
  })

// ---------- statuses (read-only catalogue) ----------

/**
 * List ticket statuses (open/pending/on_hold/solved/closed catalogue).
 * Read-only; CRUD is admin-only and not exposed yet.
 */
export const listTicketStatusesFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuthWithPermissions()
  return listTicketStatuses()
})

// ---------- activity timeline ----------

/**
 * List ticket-activity events for a single ticket. Read-gated by the same
 * `canViewTicket` rule as threads. Returns rows in reverse-chronological order
 * with optional `before` cursor (createdAt ISO) for pagination.
 */
export const listTicketActivityFn = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      ticketId: ticketIdSchema,
      limit: z.number().int().min(1).max(200).optional(),
      before: isoDate.optional(),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requireAuthWithPermissions()
    const scope = await loadScope(data.ticketId)
    if (!canViewTicket(ctx.permissions, scope)) {
      throw new ForbiddenError('TICKET_VIEW_DENIED', 'cannot view this ticket')
    }
    const limit = data.limit ?? 50
    const whereClauses = [eq(ticketActivity.ticketId, data.ticketId)]
    if (data.before) whereClauses.push(lt(ticketActivity.createdAt, new Date(data.before)))
    const rows = await db
      .select({
        id: ticketActivity.id,
        ticketId: ticketActivity.ticketId,
        principalId: ticketActivity.principalId,
        type: ticketActivity.type,
        metadata: ticketActivity.metadata,
        createdAt: ticketActivity.createdAt,
        actorName: principal.displayName,
        actorAvatarUrl: principal.avatarUrl,
      })
      .from(ticketActivity)
      .leftJoin(principal, eq(ticketActivity.principalId, principal.id))
      .where(and(...whereClauses))
      .orderBy(desc(ticketActivity.createdAt))
      .limit(limit)
    return rows as Array<{
      id: (typeof rows)[number]['id']
      ticketId: (typeof rows)[number]['ticketId']
      principalId: (typeof rows)[number]['principalId']
      type: string
      metadata: AuditJsonValue
      createdAt: Date
      actorName: string | null
      actorAvatarUrl: string | null
    }>
  })

// ---------------------------------------------------------------------------
// GitHub integration stubs (Phase 8 — not yet implemented)
// ---------------------------------------------------------------------------

/** Manually trigger a push/pull sync for a linked ticket. TODO: implement in Phase 8. */
export const manualSyncTicketFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      ticketId: ticketIdSchema,
      integrationId: z.string().min(1),
      direction: z.enum(['push', 'pull']),
    })
  )
  .handler(async ({ data: _data }) => {
    await requirePermission(PERMISSIONS.TICKET_EDIT_FIELDS)
    // TODO: implement bidirectional manual sync in Phase 8
    return { success: false, error: 'Manual sync not yet implemented' } as const
  })
