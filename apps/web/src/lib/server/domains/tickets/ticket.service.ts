/**
 * Ticket service — header-level CRUD plus status / assignment transitions.
 *
 * Optimistic concurrency: every mutation accepts an `expectedUpdatedAt` and
 * fails with `ConflictError` if the row was changed in the meantime. This is
 * enough for the ticket detail UI without paying for a separate `version` int.
 *
 * Every meaningful state change writes a `ticket_activity` row inside the
 * same transaction so the timeline is consistent with the ticket header.
 * Workspace-wide audit (`recordEvent`) is best-effort and happens after.
 */
import {
  db,
  eq,
  and,
  isNull,
  inArray,
  tickets,
  ticketStatuses,
  ticketActivity,
  principal,
  user,
  type Ticket,
  type TicketActivity,
} from '@/lib/server/db'
import type {
  TicketId,
  TicketStatusId,
  PrincipalId,
  UserId,
  TeamId,
  ContactId,
  OrganizationId,
  InboxId,
  SlaPolicyId,
  WidgetProfileId,
} from '@quackback/ids'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import { recordEvent } from '../audit'
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'
import { tiptapToPlainText } from './tiptap-text'
import {
  TICKET_PRIORITIES,
  TICKET_CHANNELS,
  TICKET_VISIBILITY_SCOPES,
  type TicketPriority,
  type TicketChannel,
  type TicketVisibilityScope,
  type TicketStatusCategory,
  type TiptapContent,
  type AuditDiff,
  type AuditJsonValue,
} from '@/lib/server/db'

const SUBJECT_MAX = 500

export interface CreateTicketInput {
  subject: string
  descriptionJson?: TiptapContent | null
  descriptionText?: string | null
  priority?: TicketPriority
  channel?: TicketChannel
  visibilityScope?: TicketVisibilityScope
  statusId?: TicketStatusId | null
  primaryTeamId?: TeamId | null
  assigneePrincipalId?: PrincipalId | null
  assigneeTeamId?: TeamId | null
  requesterPrincipalId?: PrincipalId | null
  requesterContactId?: ContactId | null
  organizationId?: OrganizationId | null
  /** Inbox the ticket should belong to (Phase 4). When omitted, the routing engine fills this in. */
  inboxId?: InboxId | null
  /** Resolved embedded widget profile that created the ticket, if any. */
  sourceWidgetProfileId?: WidgetProfileId | null
  /** SLA policy bound at ticket creation (Phase 5). When omitted, the engine selects via scope precedence. */
  slaPolicyId?: SlaPolicyId | null
  createdByPrincipalId?: PrincipalId | null
  /** Set by integration inbound handlers to prevent echo loops in the event dispatcher. */
  syncSourceIntegrationId?: string | null
}

function validateSubject(subject: string): string {
  const trimmed = subject?.trim()
  if (!trimmed) throw new ValidationError('TICKET_SUBJECT_REQUIRED', 'subject is required')
  if (trimmed.length > SUBJECT_MAX) {
    throw new ValidationError('TICKET_SUBJECT_TOO_LONG', `subject exceeds ${SUBJECT_MAX} chars`)
  }
  return trimmed
}

async function resolveDefaultStatus(): Promise<{
  id: TicketStatusId
  category: TicketStatusCategory
}> {
  const row = await db.query.ticketStatuses.findFirst({
    where: and(eq(ticketStatuses.isDefault, true), isNull(ticketStatuses.deletedAt)),
  })
  if (!row) {
    throw new ValidationError(
      'TICKET_NO_DEFAULT_STATUS',
      'No default ticket status configured; create one or pass statusId explicitly.'
    )
  }
  return { id: row.id as TicketStatusId, category: row.category as TicketStatusCategory }
}

async function resolveStatus(
  statusId: TicketStatusId
): Promise<{ id: TicketStatusId; category: TicketStatusCategory }> {
  const row = await db.query.ticketStatuses.findFirst({
    where: eq(ticketStatuses.id, statusId),
  })
  if (!row) throw new NotFoundError('TICKET_STATUS_NOT_FOUND', `status ${statusId} not found`)
  return { id: row.id as TicketStatusId, category: row.category as TicketStatusCategory }
}

async function resolveRequesterContactId(
  requesterPrincipalId: PrincipalId | null | undefined
): Promise<ContactId | null> {
  if (!requesterPrincipalId) return null

  const principalRow = await db.query.principal.findFirst({
    where: eq(principal.id, requesterPrincipalId),
    columns: { userId: true, type: true },
  })
  if (!principalRow?.userId || principalRow.type !== 'user') return null

  const { findOrCreateByEmail, linkContactToUser, listLinksForUser } =
    await import('../organizations/contact.service')

  const existingLinks = await listLinksForUser(principalRow.userId as UserId)
  if (existingLinks[0]) return existingLinks[0].contactId as ContactId

  const userRow = await db.query.user.findFirst({
    where: eq(user.id, principalRow.userId as UserId),
    columns: { email: true, emailVerified: true },
  })
  if (!userRow?.email || !userRow.emailVerified) return null

  const contact = await findOrCreateByEmail({ email: userRow.email })
  await linkContactToUser({
    contactId: contact.id as ContactId,
    userId: principalRow.userId as UserId,
    linkedByPrincipalId: null,
  })
  return contact.id as ContactId
}

async function resolveTicketCustomerContext(
  input: Pick<CreateTicketInput, 'requesterPrincipalId' | 'requesterContactId' | 'organizationId'>
): Promise<{
  requesterContactId: ContactId | null
  organizationId: OrganizationId | null
}> {
  const requesterContactId =
    input.requesterContactId !== undefined
      ? input.requesterContactId
      : await resolveRequesterContactId(input.requesterPrincipalId)

  if (input.organizationId !== undefined) {
    return {
      requesterContactId: requesterContactId ?? null,
      organizationId: input.organizationId,
    }
  }

  if (!requesterContactId) {
    return { requesterContactId: null, organizationId: null }
  }

  const { getContact } = await import('../organizations/contact.service')
  const contact = await getContact(requesterContactId)
  return {
    requesterContactId,
    organizationId: (contact?.organizationId as OrganizationId | null | undefined) ?? null,
  }
}

export async function createTicket(input: CreateTicketInput): Promise<Ticket> {
  const subject = validateSubject(input.subject)
  if (input.priority && !TICKET_PRIORITIES.includes(input.priority)) {
    throw new ValidationError('TICKET_PRIORITY_INVALID', 'invalid priority')
  }
  if (input.channel && !TICKET_CHANNELS.includes(input.channel)) {
    throw new ValidationError('TICKET_CHANNEL_INVALID', 'invalid channel')
  }
  if (input.visibilityScope && !TICKET_VISIBILITY_SCOPES.includes(input.visibilityScope)) {
    throw new ValidationError('TICKET_VISIBILITY_INVALID', 'invalid visibilityScope')
  }

  const status = input.statusId ? await resolveStatus(input.statusId) : await resolveDefaultStatus()

  const sanitizedJson = input.descriptionJson ? sanitizeTiptapContent(input.descriptionJson) : null
  const descriptionText =
    input.descriptionText?.trim() ||
    (sanitizedJson ? tiptapToPlainText(sanitizedJson) : null) ||
    null

  // Phase 4: route the ticket if no inboxId was supplied. Routing failure is
  // non-fatal — we proceed with the explicit inputs.
  let routingDecision: import('../inboxes/routing.types').RoutingDecision | null = null
  if (input.inboxId == null) {
    try {
      const { route } = await import('../inboxes/routing.engine')
      routingDecision = await route({
        subject,
        descriptionText,
        channel: input.channel ?? 'api',
        priority: input.priority,
        candidateInboxId: null,
      })
    } catch {
      routingDecision = null
    }
  }

  const resolvedInboxId = input.inboxId ?? (routingDecision?.inboxId as InboxId | undefined) ?? null
  const resolvedPrimaryTeamId =
    input.primaryTeamId ?? (routingDecision?.primaryTeamId as TeamId | undefined) ?? null
  const resolvedAssigneePrincipalId =
    input.assigneePrincipalId ??
    (routingDecision?.assigneePrincipalId as PrincipalId | undefined) ??
    null
  const resolvedAssigneeTeamId =
    input.assigneeTeamId ?? (routingDecision?.assigneeTeamId as TeamId | undefined) ?? null
  const resolvedPriority =
    input.priority ?? (routingDecision?.priority as TicketPriority | undefined) ?? 'normal'
  const resolvedVisibility =
    input.visibilityScope ??
    (routingDecision?.visibilityScope as TicketVisibilityScope | undefined) ??
    'team'

  let customerContext = {
    requesterContactId: input.requesterContactId ?? null,
    organizationId: input.organizationId ?? null,
  }
  try {
    customerContext = await resolveTicketCustomerContext(input)
  } catch (err) {
    console.warn('[tickets] resolveTicketCustomerContext failed', {
      requesterPrincipalId: input.requesterPrincipalId ?? null,
      requesterContactId: input.requesterContactId ?? null,
      error: err instanceof Error ? err.message : err,
    })
  }

  const now = new Date()
  const [created] = await db
    .insert(tickets)
    .values({
      subject,
      descriptionJson: sanitizedJson,
      descriptionText,
      priority: resolvedPriority,
      channel: input.channel ?? 'api',
      visibilityScope: resolvedVisibility,
      statusId: status.id,
      primaryTeamId: resolvedPrimaryTeamId,
      assigneePrincipalId: resolvedAssigneePrincipalId,
      assigneeTeamId: resolvedAssigneeTeamId,
      requesterPrincipalId: input.requesterPrincipalId ?? null,
      requesterContactId: customerContext.requesterContactId,
      organizationId: customerContext.organizationId,
      inboxId: resolvedInboxId,
      sourceWidgetProfileId: input.sourceWidgetProfileId ?? null,
      slaPolicyId: input.slaPolicyId ?? null,
      createdByPrincipalId: input.createdByPrincipalId ?? null,
      lastActivityAt: now,
    })
    .returning()

  await writeActivity(
    created.id as TicketId,
    input.createdByPrincipalId ?? null,
    'ticket.created',
    {
      statusCategory: status.category,
      channel: input.channel ?? 'api',
      priority: input.priority ?? 'normal',
      sourceWidgetProfileId: input.sourceWidgetProfileId ?? null,
    }
  )
  if (routingDecision && (routingDecision.matchedRuleId || routingDecision.inboxId)) {
    await writeActivity(
      created.id as TicketId,
      input.createdByPrincipalId ?? null,
      'ticket.routed',
      {
        ruleId: routingDecision.matchedRuleId ?? null,
        inboxId: (routingDecision.inboxId as string | null | undefined) ?? null,
        primaryTeamId: (routingDecision.primaryTeamId as string | null | undefined) ?? null,
        assigneePrincipalId:
          (routingDecision.assigneePrincipalId as string | null | undefined) ?? null,
      }
    )
    if (routingDecision.matchedRuleId) {
      try {
        const { bumpMatchStats } = await import('../inboxes/routing.service')
        await bumpMatchStats(routingDecision.matchedRuleId as never)
      } catch {
        // best-effort
      }
    }
  }
  void recordEvent({
    principalId: input.createdByPrincipalId ?? null,
    action: 'ticket.created',
    targetType: 'ticket',
    targetId: created.id,
    diff: {
      context: { subject, statusId: status.id, priority: input.priority ?? 'normal' },
    },
  })

  // Phase 5: SLA policy assignment + clock attachment. Best-effort; never fails creation.
  try {
    const { attachClocksOnCreate } = await import('../sla/sla.engine')
    await attachClocksOnCreate(created, input.createdByPrincipalId ?? null)
  } catch (err) {
    console.warn('[tickets] attachClocksOnCreate failed', err)
  }

  // Phase 7: auto-subscribe + dispatch ticket.created notification.
  try {
    const { safeSubscribe } = await import('./ticket.subscriptions')
    if (input.requesterPrincipalId) {
      await safeSubscribe({
        ticketId: created.id as TicketId,
        principalId: input.requesterPrincipalId,
        source: 'manual',
      })
    }
    if (resolvedAssigneePrincipalId) {
      await safeSubscribe({
        ticketId: created.id as TicketId,
        principalId: resolvedAssigneePrincipalId,
        source: 'auto_assigned',
      })
    }
    const { notifyTicketCreated } = await import('./ticket.notifications')
    await notifyTicketCreated(created, { actorPrincipalId: input.createdByPrincipalId ?? null })
  } catch (err) {
    console.warn('[tickets] notifyTicketCreated failed', err)
  }

  // Phase 7.5: outbound webhook event.
  try {
    const { dispatchTicketCreated, buildEventActor } = await import('@/lib/server/events/dispatch')
    const actor = input.createdByPrincipalId
      ? buildEventActor({ principalId: input.createdByPrincipalId, displayName: 'ticket-system' })
      : { type: 'service' as const, displayName: 'ticket-system' }
    await dispatchTicketCreated(actor, created as unknown as Record<string, unknown>, {
      syncSourceIntegrationId: input.syncSourceIntegrationId,
    })
  } catch (err) {
    console.warn('[tickets] dispatchTicketCreated failed', err)
  }

  return created
}

export async function getTicket(ticketId: TicketId): Promise<Ticket | null> {
  const row = await db.query.tickets.findFirst({
    where: and(eq(tickets.id, ticketId), isNull(tickets.deletedAt)),
  })
  return row ?? null
}

export interface UpdateTicketInput {
  expectedUpdatedAt: Date
  actorPrincipalId: PrincipalId | null
  subject?: string
  descriptionJson?: TiptapContent | null
  descriptionText?: string | null
  priority?: TicketPriority
  visibilityScope?: TicketVisibilityScope
  primaryTeamId?: TeamId | null
  organizationId?: OrganizationId | null
  requesterContactId?: ContactId | null
  inboxId?: InboxId | null
  /** Set by integration inbound handlers to prevent echo loops. */
  syncSourceIntegrationId?: string | null
  /** Allow single-field description edits to merge over unrelated freshness drift. */
  allowStaleDescriptionUpdate?: boolean
}

export async function updateTicket(ticketId: TicketId, input: UpdateTicketInput): Promise<Ticket> {
  let existing = await getTicket(ticketId)
  if (!existing) throw new NotFoundError('TICKET_NOT_FOUND', `ticket ${ticketId} not found`)
  const stale = existing.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
  if (stale && !canMergeStaleDescriptionUpdate(input)) {
    ensureFresh(existing.updatedAt, input.expectedUpdatedAt)
  }

  if (stale) {
    const latest = await getTicket(ticketId)
    if (!latest) throw new NotFoundError('TICKET_NOT_FOUND', `ticket ${ticketId} not found`)
    existing = latest
  }

  const patch: Partial<typeof existing> = {}
  const diff: Record<string, { from: unknown; to: unknown }> = {}

  if (input.subject !== undefined) {
    const next = validateSubject(input.subject)
    if (next !== existing.subject) {
      patch.subject = next
      diff.subject = { from: existing.subject, to: next }
    }
  }
  if (input.descriptionJson !== undefined) {
    patch.descriptionJson = input.descriptionJson
    diff.descriptionJson = { from: '[rich-text]', to: '[rich-text]' }
  }
  if (input.descriptionText !== undefined) {
    patch.descriptionText = input.descriptionText
    diff.descriptionText = { from: existing.descriptionText, to: input.descriptionText }
  }
  if (input.priority !== undefined && input.priority !== existing.priority) {
    if (!TICKET_PRIORITIES.includes(input.priority)) {
      throw new ValidationError('TICKET_PRIORITY_INVALID', 'invalid priority')
    }
    patch.priority = input.priority
    diff.priority = { from: existing.priority, to: input.priority }
  }
  if (input.visibilityScope !== undefined && input.visibilityScope !== existing.visibilityScope) {
    if (!TICKET_VISIBILITY_SCOPES.includes(input.visibilityScope)) {
      throw new ValidationError('TICKET_VISIBILITY_INVALID', 'invalid visibilityScope')
    }
    patch.visibilityScope = input.visibilityScope
    diff.visibilityScope = { from: existing.visibilityScope, to: input.visibilityScope }
  }
  if (input.primaryTeamId !== undefined && input.primaryTeamId !== existing.primaryTeamId) {
    patch.primaryTeamId = input.primaryTeamId
    diff.primaryTeamId = { from: existing.primaryTeamId, to: input.primaryTeamId }
  }
  if (input.organizationId !== undefined && input.organizationId !== existing.organizationId) {
    patch.organizationId = input.organizationId
    diff.organizationId = { from: existing.organizationId, to: input.organizationId }
  }
  if (
    input.requesterContactId !== undefined &&
    input.requesterContactId !== existing.requesterContactId
  ) {
    patch.requesterContactId = input.requesterContactId
    diff.requesterContactId = { from: existing.requesterContactId, to: input.requesterContactId }
  }
  if (input.inboxId !== undefined && input.inboxId !== existing.inboxId) {
    patch.inboxId = input.inboxId
    diff.inboxId = { from: existing.inboxId, to: input.inboxId }
  }

  if (Object.keys(patch).length === 0) return existing

  patch.lastActivityAt = new Date()
  const mergeStaleDescription = canMergeStaleDescriptionUpdate(input)
  const [updated] = await db
    .update(tickets)
    .set(patch)
    .where(
      mergeStaleDescription
        ? and(eq(tickets.id, ticketId), isNull(tickets.deletedAt))
        : and(eq(tickets.id, ticketId), eq(tickets.updatedAt, existing.updatedAt))
    )
    .returning()

  if (!updated) {
    throw new ConflictError('TICKET_STALE', 'ticket was modified concurrently')
  }
  await writeActivity(ticketId, input.actorPrincipalId, 'ticket.updated', { diff })
  void recordEvent({
    principalId: input.actorPrincipalId,
    action: 'ticket.updated',
    targetType: 'ticket',
    targetId: ticketId,
    diff: diffToAuditDiff(diff),
  })
  try {
    const { dispatchTicketUpdated, buildEventActor } = await import('@/lib/server/events/dispatch')
    const actor = input.actorPrincipalId
      ? buildEventActor({ principalId: input.actorPrincipalId, displayName: 'ticket-system' })
      : { type: 'service' as const, displayName: 'ticket-system' }
    await dispatchTicketUpdated(
      actor,
      updated as unknown as Record<string, unknown>,
      Object.keys(diff),
      diff,
      { syncSourceIntegrationId: input.syncSourceIntegrationId }
    )
  } catch (err) {
    console.warn('[tickets] dispatchTicketUpdated failed', err)
  }
  return updated
}

export interface AssignTicketInput {
  expectedUpdatedAt: Date
  actorPrincipalId: PrincipalId | null
  assigneePrincipalId?: PrincipalId | null
  assigneeTeamId?: TeamId | null
  /** Set by integration inbound handlers to prevent echo loops. */
  syncSourceIntegrationId?: string | null
}

export async function assignTicket(ticketId: TicketId, input: AssignTicketInput): Promise<Ticket> {
  const existing = await getTicket(ticketId)
  if (!existing) throw new NotFoundError('TICKET_NOT_FOUND', `ticket ${ticketId} not found`)
  ensureFresh(existing.updatedAt, input.expectedUpdatedAt)

  const nextPrincipalId =
    input.assigneePrincipalId === undefined
      ? existing.assigneePrincipalId
      : input.assigneePrincipalId
  const nextTeamId =
    input.assigneeTeamId === undefined ? existing.assigneeTeamId : input.assigneeTeamId

  const noChange =
    nextPrincipalId === existing.assigneePrincipalId && nextTeamId === existing.assigneeTeamId
  if (noChange) return existing

  const [updated] = await db
    .update(tickets)
    .set({
      assigneePrincipalId: nextPrincipalId,
      assigneeTeamId: nextTeamId,
      lastActivityAt: new Date(),
    })
    .where(and(eq(tickets.id, ticketId), eq(tickets.updatedAt, existing.updatedAt)))
    .returning()
  if (!updated) throw new ConflictError('TICKET_STALE', 'ticket was modified concurrently')

  const activityType =
    nextPrincipalId == null && nextTeamId == null ? 'ticket.unassigned' : 'ticket.assigned'
  await writeActivity(ticketId, input.actorPrincipalId, activityType, {
    from: {
      principalId: existing.assigneePrincipalId,
      teamId: existing.assigneeTeamId,
    },
    to: { principalId: nextPrincipalId, teamId: nextTeamId },
  })
  void recordEvent({
    principalId: input.actorPrincipalId,
    action: activityType,
    targetType: 'ticket',
    targetId: ticketId,
    diff: {
      before: {
        assigneePrincipalId: existing.assigneePrincipalId,
        assigneeTeamId: existing.assigneeTeamId,
      },
      after: {
        assigneePrincipalId: nextPrincipalId,
        assigneeTeamId: nextTeamId,
      },
    },
  })

  // Phase 7: auto-subscribe new assignee + dispatch notification.
  try {
    const { safeSubscribe } = await import('./ticket.subscriptions')
    if (nextPrincipalId) {
      await safeSubscribe({
        ticketId,
        principalId: nextPrincipalId,
        source: 'auto_assigned',
      })
    }
    const { notifyTicketAssigned } = await import('./ticket.notifications')
    await notifyTicketAssigned(updated, existing.assigneePrincipalId as PrincipalId | null, {
      actorPrincipalId: input.actorPrincipalId,
    })
  } catch (err) {
    console.warn('[tickets] notifyTicketAssigned failed', err)
  }

  // Phase 7.5: outbound webhook events. Emit ticket.assigned when there is
  // a new assignee; emit ticket.unassigned when the previous assignee was
  // cleared (or replaced).
  try {
    const { dispatchTicketAssigned, dispatchTicketUnassigned, buildEventActor } =
      await import('@/lib/server/events/dispatch')
    const actor = input.actorPrincipalId
      ? buildEventActor({ principalId: input.actorPrincipalId, displayName: 'ticket-system' })
      : { type: 'service' as const, displayName: 'ticket-system' }
    const prev = (existing.assigneePrincipalId as PrincipalId | null) ?? null
    const next = (updated.assigneePrincipalId as PrincipalId | null) ?? null
    if (next) {
      await dispatchTicketAssigned(
        actor,
        updated as unknown as Record<string, unknown>,
        prev,
        next,
        { syncSourceIntegrationId: input.syncSourceIntegrationId }
      )
    }
    if (prev && prev !== next) {
      await dispatchTicketUnassigned(actor, updated as unknown as Record<string, unknown>, prev, {
        syncSourceIntegrationId: input.syncSourceIntegrationId,
      })
    }
  } catch (err) {
    console.warn('[tickets] dispatchTicketAssigned/Unassigned failed', err)
  }

  return updated
}

export interface TransitionStatusInput {
  expectedUpdatedAt: Date
  actorPrincipalId: PrincipalId | null
  statusId: TicketStatusId
  /** Set by integration inbound handlers to prevent echo loops. */
  syncSourceIntegrationId?: string | null
}

/**
 * Move the ticket to a new status. Sets lifecycle timestamps based on the
 * destination *category*, not its slug — so workspaces can rename statuses
 * without breaking SLA / reporting later.
 *
 * Timestamp rules:
 *   - resolved category  → set resolvedAt (clears reopenedAt unless still set)
 *   - closed category    → set closedAt (and resolvedAt if not yet)
 *   - any open/pending/on_hold from a resolved/closed → set reopenedAt + clear resolvedAt/closedAt
 */
export async function transitionStatus(
  ticketId: TicketId,
  input: TransitionStatusInput
): Promise<Ticket> {
  const existing = await getTicket(ticketId)
  if (!existing) throw new NotFoundError('TICKET_NOT_FOUND', `ticket ${ticketId} not found`)
  ensureFresh(existing.updatedAt, input.expectedUpdatedAt)
  if (existing.statusId === input.statusId) return existing

  const next = await resolveStatus(input.statusId)
  const prevStatus = existing.statusId
    ? await resolveStatus(existing.statusId as TicketStatusId)
    : null

  const now = new Date()
  const patch: Partial<typeof existing> = {
    statusId: next.id,
    lastActivityAt: now,
  }

  const wasTerminal = prevStatus?.category === 'solved' || prevStatus?.category === 'closed'
  const isTerminal = next.category === 'solved' || next.category === 'closed'

  if (next.category === 'solved') {
    patch.resolvedAt = existing.resolvedAt ?? now
    patch.closedAt = null
  } else if (next.category === 'closed') {
    patch.resolvedAt = existing.resolvedAt ?? now
    patch.closedAt = now
  } else if (wasTerminal && !isTerminal) {
    patch.reopenedAt = now
    patch.resolvedAt = null
    patch.closedAt = null
  }

  const [updated] = await db
    .update(tickets)
    .set(patch)
    .where(and(eq(tickets.id, ticketId), eq(tickets.updatedAt, existing.updatedAt)))
    .returning()
  if (!updated) throw new ConflictError('TICKET_STALE', 'ticket was modified concurrently')

  await writeActivity(ticketId, input.actorPrincipalId, 'ticket.status_changed', {
    from: { statusId: existing.statusId, category: prevStatus?.category ?? null },
    to: { statusId: next.id, category: next.category },
  })
  void recordEvent({
    principalId: input.actorPrincipalId,
    action: 'ticket.status_changed',
    targetType: 'ticket',
    targetId: ticketId,
    diff: {
      before: { statusId: existing.statusId },
      after: { statusId: next.id },
      context: { categoryFrom: prevStatus?.category ?? null, categoryTo: next.category },
    },
  })

  // Phase 5: react to category transition for SLA pause/resume/met/cancel.
  try {
    const { onStatusTransition } = await import('../sla/sla.engine')
    await onStatusTransition(
      updated,
      prevStatus?.category ?? null,
      next.category,
      input.actorPrincipalId
    )
  } catch (err) {
    console.warn('[tickets] sla.onStatusTransition failed', err)
  }

  // Phase 7: dispatch ticket.status_changed notification.
  try {
    const { notifyTicketStatusChanged } = await import('./ticket.notifications')
    await notifyTicketStatusChanged(updated, prevStatus?.category ?? null, next.category, {
      actorPrincipalId: input.actorPrincipalId,
    })
  } catch (err) {
    console.warn('[tickets] notifyTicketStatusChanged failed', err)
  }

  // Phase 7.5: outbound webhook event.
  try {
    const { dispatchTicketStatusChanged, buildEventActor } =
      await import('@/lib/server/events/dispatch')
    const actor = input.actorPrincipalId
      ? buildEventActor({ principalId: input.actorPrincipalId, displayName: 'ticket-system' })
      : { type: 'service' as const, displayName: 'ticket-system' }
    await dispatchTicketStatusChanged(
      actor,
      updated as unknown as Record<string, unknown>,
      prevStatus?.category ?? null,
      next.category,
      { syncSourceIntegrationId: input.syncSourceIntegrationId }
    )
  } catch (err) {
    console.warn('[tickets] dispatchTicketStatusChanged failed', err)
  }

  return updated
}

export async function softDeleteTicket(
  ticketId: TicketId,
  actorPrincipalId: PrincipalId | null
): Promise<Ticket> {
  const existing = await getTicket(ticketId)
  if (!existing) throw new NotFoundError('TICKET_NOT_FOUND', `ticket ${ticketId} not found`)
  const now = new Date()
  const [updated] = await db
    .update(tickets)
    .set({
      deletedAt: now,
      deletedByPrincipalId: actorPrincipalId,
      lastActivityAt: now,
    })
    .where(eq(tickets.id, ticketId))
    .returning()
  await writeActivity(ticketId, actorPrincipalId, 'ticket.deleted', {})
  void recordEvent({
    principalId: actorPrincipalId,
    action: 'ticket.deleted',
    targetType: 'ticket',
    targetId: ticketId,
  })
  try {
    const { dispatchTicketDeleted, buildEventActor } = await import('@/lib/server/events/dispatch')
    const actor = actorPrincipalId
      ? buildEventActor({ principalId: actorPrincipalId })
      : { type: 'service' as const, displayName: 'ticket-system' }
    await dispatchTicketDeleted(
      actor,
      updated as unknown as Record<string, unknown>,
      actorPrincipalId
    )
  } catch (err) {
    console.warn('[tickets] dispatchTicketDeleted failed', err)
  }
  return updated
}

export async function restoreTicket(
  ticketId: TicketId,
  actorPrincipalId: PrincipalId | null
): Promise<Ticket> {
  const existing = await getTicket(ticketId)
  if (!existing) throw new NotFoundError('TICKET_NOT_FOUND', `ticket ${ticketId} not found`)
  if (!existing.deletedAt)
    throw new NotFoundError('TICKET_NOT_DELETED', `ticket ${ticketId} is not deleted`)
  const now = new Date()
  const [updated] = await db
    .update(tickets)
    .set({
      deletedAt: null,
      deletedByPrincipalId: null,
      lastActivityAt: now,
    })
    .where(eq(tickets.id, ticketId))
    .returning()
  await writeActivity(ticketId, actorPrincipalId, 'ticket.restored', {})
  void recordEvent({
    principalId: actorPrincipalId,
    action: 'ticket.restored',
    targetType: 'ticket',
    targetId: ticketId,
  })
  try {
    const { dispatchTicketRestored, buildEventActor } = await import('@/lib/server/events/dispatch')
    const actor = actorPrincipalId
      ? buildEventActor({ principalId: actorPrincipalId })
      : { type: 'service' as const, displayName: 'ticket-system' }
    await dispatchTicketRestored(
      actor,
      updated as unknown as Record<string, unknown>,
      actorPrincipalId
    )
  } catch (err) {
    console.warn('[tickets] dispatchTicketRestored failed', err)
  }
  return updated
}

/** Note `bumpLastActivity` is intentionally separate from the activity row — */
/* threads/participants/shares all bump it from their respective services. */
export async function bumpLastActivity(ticketId: TicketId): Promise<void> {
  await db.update(tickets).set({ lastActivityAt: new Date() }).where(eq(tickets.id, ticketId))
}

// ---------------------------------------------------------------------------
// internal helpers
// ---------------------------------------------------------------------------

function ensureFresh(actualUpdatedAt: Date, expectedUpdatedAt: Date): void {
  if (actualUpdatedAt.getTime() !== expectedUpdatedAt.getTime()) {
    throw new ConflictError('TICKET_STALE', 'ticket was modified concurrently — refresh and retry')
  }
}

function canMergeStaleDescriptionUpdate(input: UpdateTicketInput): boolean {
  if (!input.allowStaleDescriptionUpdate) return false
  return (
    input.subject === undefined &&
    input.priority === undefined &&
    input.visibilityScope === undefined &&
    input.primaryTeamId === undefined &&
    input.organizationId === undefined &&
    input.requesterContactId === undefined &&
    input.inboxId === undefined &&
    (input.descriptionJson !== undefined || input.descriptionText !== undefined)
  )
}

/** Convert a `{ field: { from, to } }` shaped diff to the AuditDiff shape. */
function diffToAuditDiff(diff: Record<string, { from: unknown; to: unknown }>): AuditDiff {
  const before: Record<string, AuditJsonValue> = {}
  const after: Record<string, AuditJsonValue> = {}
  for (const [k, v] of Object.entries(diff)) {
    before[k] = (v.from as AuditJsonValue) ?? null
    after[k] = (v.to as AuditJsonValue) ?? null
  }
  return { before, after }
}

export async function writeActivity(
  ticketId: TicketId,
  principalId: PrincipalId | null,
  type: string,
  metadata: Record<string, unknown>
): Promise<TicketActivity> {
  const [row] = await db
    .insert(ticketActivity)
    .values({ ticketId, principalId, type, metadata })
    .returning()
  return row
}

/** Query helper used by both ticket-shares.service and queue listings. */
export async function loadTicketsByIds(ids: readonly TicketId[]): Promise<Ticket[]> {
  if (ids.length === 0) return []
  return db
    .select()
    .from(tickets)
    .where(and(inArray(tickets.id, ids as TicketId[]), isNull(tickets.deletedAt)))
}
