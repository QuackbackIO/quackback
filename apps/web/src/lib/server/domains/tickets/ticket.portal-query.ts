/**
 * Portal-side ticket access — ownership-gated, NOT permission-gated.
 *
 * The staff-side `listTickets` enforces a queue scope + permission set.
 * Portal users have an intentionally-empty role bundle, so we cannot reuse
 * that path. Instead, every portal query is filtered by an OWNERSHIP
 * predicate built from the user's identity-set:
 *
 *   identity-set := principalId(userId) ∪ linkedContactIds(userId)
 *
 * A ticket is visible iff:
 *   - `requesterPrincipalId` matches the user's principal, OR
 *   - `requesterContactId`   matches one of the user's linked contacts, OR
 *   - the user appears in `ticket_participants` via either subject column.
 *
 * Misses ALWAYS surface as `NotFoundError` (never `ForbiddenError`) so we
 * don't leak existence of tickets the portal user has no relationship with.
 */
import {
  db,
  eq,
  and,
  or,
  isNull,
  inArray,
  desc,
  sql,
  tickets,
  ticketStatuses,
  ticketParticipants,
  type Ticket,
  type TicketStatusCategory,
  type TiptapContent,
} from '@/lib/server/db'
import type {
  ContactId,
  InboxId,
  PrincipalId,
  TicketId,
  UserId,
  WidgetProfileId,
} from '@quackback/ids'
import type { TicketThread } from '@/lib/server/db'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/shared/errors'
import { getMemberByUser } from '../principals/principal.service'
import { listLinksForUser } from '../organizations/contact.service'
import { addThread } from './ticket.threads'
import { updateTicket, transitionStatus } from './ticket.service'
import { listTicketStatuses } from './ticket-statuses.service'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

export interface PortalIdentity {
  principalId: PrincipalId | null
  contactIds: ContactId[]
}

export type PortalViewerRelationship = 'requester' | 'collaborator' | 'watcher' | 'cc'

/**
 * Resolve the union of principal + linked contacts that this portal user
 * "is". Never throws — callers treat an empty identity as "no access".
 */
export async function buildPortalIdentity(userId: UserId): Promise<PortalIdentity> {
  const [memberRow, links] = await Promise.all([getMemberByUser(userId), listLinksForUser(userId)])
  const contactIds = Array.from(new Set(links.map((l) => l.contactId as ContactId)))
  return {
    principalId: (memberRow?.id as PrincipalId | undefined) ?? null,
    contactIds,
  }
}

/**
 * Compose the ownership predicate. Returns `null` when the identity is empty
 * (caller should short-circuit to no-results).
 */
function ownershipWhere(identity: PortalIdentity) {
  const branches = []
  if (identity.principalId) {
    branches.push(eq(tickets.requesterPrincipalId, identity.principalId))
  }
  if (identity.contactIds.length > 0) {
    branches.push(inArray(tickets.requesterContactId, identity.contactIds))
  }
  // Participant subquery — include only when at least one identity column matches.
  const participantBranches = []
  if (identity.principalId) {
    participantBranches.push(eq(ticketParticipants.principalId, identity.principalId))
  }
  if (identity.contactIds.length > 0) {
    participantBranches.push(inArray(ticketParticipants.contactId, identity.contactIds))
  }
  if (participantBranches.length > 0) {
    branches.push(
      inArray(
        tickets.id,
        db
          .select({ id: ticketParticipants.ticketId })
          .from(ticketParticipants)
          .where(
            participantBranches.length === 1 ? participantBranches[0] : or(...participantBranches)
          )
      )
    )
  }
  if (branches.length === 0) return null
  return branches.length === 1 ? branches[0] : or(...branches)
}

export interface ListTicketsForPortalUserOptions {
  userId: UserId
  statusCategory?: TicketStatusCategory
  limit?: number
  offset?: number
  sourceWidgetProfileId?: WidgetProfileId | null
  allowedInboxIds?: InboxId[] | null
}

export async function listTicketsForPortalUser(
  opts: ListTicketsForPortalUserOptions
): Promise<{ rows: Ticket[]; total: number }> {
  const identity = await buildPortalIdentity(opts.userId)
  const ownership = ownershipWhere(identity)
  if (!ownership) return { rows: [], total: 0 }

  const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
  const offset = Math.max(opts.offset ?? 0, 0)

  const filters = [isNull(tickets.deletedAt), ownership]
  if (opts.statusCategory) {
    filters.push(
      inArray(
        tickets.statusId,
        db
          .select({ id: ticketStatuses.id })
          .from(ticketStatuses)
          .where(eq(ticketStatuses.category, opts.statusCategory))
      )
    )
  }
  if (opts.sourceWidgetProfileId) {
    filters.push(eq(tickets.sourceWidgetProfileId, opts.sourceWidgetProfileId))
  }
  if (opts.allowedInboxIds) {
    if (opts.allowedInboxIds.length === 0) return { rows: [], total: 0 }
    filters.push(inArray(tickets.inboxId, opts.allowedInboxIds))
  }
  const where = and(...filters)

  const [rows, [{ count }]] = await Promise.all([
    db
      .select()
      .from(tickets)
      .where(where)
      .orderBy(desc(tickets.lastActivityAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(tickets)
      .where(where),
  ])
  return { rows, total: count }
}

export interface GetTicketForPortalUserOptions {
  userId: UserId
  ticketId: TicketId
}

export async function getTicketForPortalUser(opts: GetTicketForPortalUserOptions): Promise<Ticket> {
  const identity = await buildPortalIdentity(opts.userId)
  const ownership = ownershipWhere(identity)
  if (!ownership) {
    throw new NotFoundError('TICKET_NOT_FOUND', `ticket ${opts.ticketId} not found`)
  }
  const row = await db.query.tickets.findFirst({
    where: and(eq(tickets.id, opts.ticketId), isNull(tickets.deletedAt), ownership),
  })
  if (!row) {
    // Deliberately NotFound, never Forbidden, to avoid existence leak.
    throw new NotFoundError('TICKET_NOT_FOUND', `ticket ${opts.ticketId} not found`)
  }
  return row
}

/**
 * Determine the viewer's relationship to a ticket given their identity set.
 * Returns 'requester' if the viewer owns the ticket, otherwise the participant
 * role ('collaborator' | 'watcher' | 'cc'). Falls back to 'watcher' if no
 * matching participant row is found (defensive).
 */
export async function resolveViewerRelationship(
  ticket: Ticket,
  identity: PortalIdentity
): Promise<PortalViewerRelationship> {
  // Check requester by principal
  if (identity.principalId && ticket.requesterPrincipalId === identity.principalId) {
    return 'requester'
  }
  // Check requester by contact
  if (
    ticket.requesterContactId &&
    identity.contactIds.includes(ticket.requesterContactId as ContactId)
  ) {
    return 'requester'
  }
  // Must be a participant — look up the role.
  const branches = []
  if (identity.principalId) {
    branches.push(
      and(
        eq(ticketParticipants.ticketId, ticket.id as TicketId),
        eq(ticketParticipants.principalId, identity.principalId)
      )
    )
  }
  if (identity.contactIds.length > 0) {
    branches.push(
      and(
        eq(ticketParticipants.ticketId, ticket.id as TicketId),
        inArray(ticketParticipants.contactId, identity.contactIds)
      )
    )
  }
  if (branches.length === 0) return 'watcher'
  const row = await db.query.ticketParticipants.findFirst({
    where: branches.length === 1 ? branches[0] : or(...branches),
  })
  return (row?.role as PortalViewerRelationship) ?? 'watcher'
}

export interface AddPortalReplyOptions {
  userId: UserId
  ticketId: TicketId
  bodyJson?: TiptapContent | null
  bodyText?: string | null
}

export async function addPortalReply(opts: AddPortalReplyOptions): Promise<TicketThread> {
  // Re-check ownership; throws NotFoundError on miss.
  const ticket = await getTicketForPortalUser({ userId: opts.userId, ticketId: opts.ticketId })

  const member = await getMemberByUser(opts.userId)
  if (!member) {
    // Server-side invariant: portal users always have a principal row from auth.
    throw new ForbiddenError('PORTAL_NO_PRINCIPAL', 'portal user has no principal')
  }

  // Reject replies to closed tickets (UI also disables the composer).
  const status = ticket.statusId
    ? await db.query.ticketStatuses.findFirst({
        where: eq(ticketStatuses.id, ticket.statusId),
      })
    : undefined
  if (status?.category === 'closed') {
    throw new ConflictError('TICKET_CLOSED', 'cannot reply to a closed ticket')
  }

  // Only requesters and collaborators may reply; watchers/cc are view-only.
  const identity = await buildPortalIdentity(opts.userId)
  const relationship = await resolveViewerRelationship(ticket, identity)
  if (relationship !== 'requester' && relationship !== 'collaborator') {
    throw new ForbiddenError('PORTAL_REPLY_DENIED', 'participants with this role cannot reply')
  }

  return addThread({
    ticketId: opts.ticketId,
    principalId: member.id as PrincipalId,
    audience: 'public',
    bodyJson: opts.bodyJson ?? null,
    bodyText: opts.bodyText ?? null,
  })
}

export interface UpdatePortalTicketDescriptionOptions {
  userId: UserId
  ticketId: TicketId
  expectedUpdatedAt: Date
  descriptionJson?: TiptapContent | null
  descriptionText?: string | null
}

export async function updatePortalTicketDescription(
  opts: UpdatePortalTicketDescriptionOptions
): Promise<Ticket> {
  // Re-check ownership; throws NotFoundError on miss.
  const ticket = await getTicketForPortalUser({ userId: opts.userId, ticketId: opts.ticketId })

  const member = await getMemberByUser(opts.userId)
  if (!member) {
    throw new ForbiddenError('PORTAL_NO_PRINCIPAL', 'portal user has no principal')
  }

  // Reject edits to closed tickets.
  const status = ticket.statusId
    ? await db.query.ticketStatuses.findFirst({
        where: eq(ticketStatuses.id, ticket.statusId),
      })
    : undefined
  if (status?.category === 'closed') {
    throw new ConflictError('TICKET_CLOSED', 'cannot edit a closed ticket')
  }

  // Requesters and collaborators may edit the description.
  const identity = await buildPortalIdentity(opts.userId)
  const relationship = await resolveViewerRelationship(ticket, identity)
  if (relationship !== 'requester' && relationship !== 'collaborator') {
    throw new ForbiddenError(
      'PORTAL_EDIT_DENIED',
      'participants with this role cannot edit the description'
    )
  }

  return updateTicket(opts.ticketId, {
    expectedUpdatedAt: opts.expectedUpdatedAt,
    actorPrincipalId: member.id as PrincipalId,
    descriptionJson: opts.descriptionJson,
    descriptionText: opts.descriptionText,
    allowStaleFieldUpdate: true,
  })
}

// ---------------------------------------------------------------------------
// Portal close / reopen
// ---------------------------------------------------------------------------

export interface ClosePortalTicketOptions {
  userId: UserId
  ticketId: TicketId
}

/**
 * Requester marks their ticket as solved. Only allowed from open / pending /
 * on_hold categories. Transitions to the first status with category 'solved'.
 */
export async function closePortalTicket(opts: ClosePortalTicketOptions): Promise<Ticket> {
  const ticket = await getTicketForPortalUser({ userId: opts.userId, ticketId: opts.ticketId })

  const member = await getMemberByUser(opts.userId)
  if (!member) {
    throw new ForbiddenError('PORTAL_NO_PRINCIPAL', 'portal user has no principal')
  }

  // Only the requester can close/reopen.
  const identity = await buildPortalIdentity(opts.userId)
  const relationship = await resolveViewerRelationship(ticket, identity)
  if (relationship !== 'requester') {
    throw new ForbiddenError(
      'PORTAL_CLOSE_DENIED',
      'only the requester can mark a ticket as solved'
    )
  }

  // Must be in an active category.
  const currentStatus = ticket.statusId
    ? await db.query.ticketStatuses.findFirst({ where: eq(ticketStatuses.id, ticket.statusId) })
    : undefined
  const activeCats: TicketStatusCategory[] = ['open', 'pending', 'on_hold']
  if (!currentStatus || !activeCats.includes(currentStatus.category as TicketStatusCategory)) {
    throw new ConflictError('TICKET_NOT_ACTIVE', 'ticket is not in an active state')
  }

  // Find the first 'solved' status.
  const allStatuses = await listTicketStatuses()
  const solvedStatus = allStatuses.find((s) => s.category === 'solved')
  if (!solvedStatus) {
    throw new ConflictError('NO_SOLVED_STATUS', 'no solved status configured')
  }

  return transitionStatus(opts.ticketId, {
    expectedUpdatedAt: ticket.updatedAt,
    actorPrincipalId: member.id as PrincipalId,
    statusId: solvedStatus.id,
  })
}

export interface ReopenPortalTicketOptions {
  userId: UserId
  ticketId: TicketId
}

/**
 * Requester reopens a solved ticket. Only allowed from 'solved' category.
 * Transitions to the first status with category 'open'.
 * Closed tickets (admin-final) cannot be reopened from the portal.
 */
export async function reopenPortalTicket(opts: ReopenPortalTicketOptions): Promise<Ticket> {
  const ticket = await getTicketForPortalUser({ userId: opts.userId, ticketId: opts.ticketId })

  const member = await getMemberByUser(opts.userId)
  if (!member) {
    throw new ForbiddenError('PORTAL_NO_PRINCIPAL', 'portal user has no principal')
  }

  // Only the requester can reopen.
  const identity = await buildPortalIdentity(opts.userId)
  const relationship = await resolveViewerRelationship(ticket, identity)
  if (relationship !== 'requester') {
    throw new ForbiddenError('PORTAL_REOPEN_DENIED', 'only the requester can reopen a ticket')
  }

  // Must be solved (not closed — closed is admin-final).
  const currentStatus = ticket.statusId
    ? await db.query.ticketStatuses.findFirst({ where: eq(ticketStatuses.id, ticket.statusId) })
    : undefined
  if (!currentStatus || currentStatus.category !== 'solved') {
    throw new ConflictError('TICKET_NOT_SOLVED', 'only solved tickets can be reopened')
  }

  // Find the first 'open' status.
  const allStatuses = await listTicketStatuses()
  const openStatus = allStatuses.find((s) => s.category === 'open')
  if (!openStatus) {
    throw new ConflictError('NO_OPEN_STATUS', 'no open status configured')
  }

  return transitionStatus(opts.ticketId, {
    expectedUpdatedAt: ticket.updatedAt,
    actorPrincipalId: member.id as PrincipalId,
    statusId: openStatus.id,
  })
}
