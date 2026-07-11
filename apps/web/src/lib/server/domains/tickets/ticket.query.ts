/**
 * Ticket queue queries — scope-aware listings for the agent UI and REST.
 *
 * `scope` selects a queue lens; the function picks the correct WHERE clause
 * AND validates that the actor's PermissionSet contains a permission that
 * actually authorises the lens. This keeps "scope" and "permission" coupled
 * so a UI bug can never widen the result set.
 *
 * Sorting and pagination are kept simple (offset+limit) for Phase 3; cursor
 * pagination ships in Phase 7 when the queue grows.
 */
import {
  db,
  eq,
  and,
  or,
  isNull,
  inArray,
  desc,
  asc,
  ilike,
  sql,
  tickets,
  ticketShares,
  ticketStatuses,
  inboxMemberships,
  type Ticket,
  type TicketStatusCategory,
} from '@/lib/server/db'
import type { TeamId, TicketStatusId, InboxId, OrganizationId, ContactId } from '@quackback/ids'
import { ForbiddenError, ValidationError } from '@/lib/shared/errors'
import { PERMISSIONS } from '../authz'
import { hasPermission, type PermissionSet } from '../authz/authz.service'

export type TicketQueueScope =
  | 'all'
  | 'my_assigned'
  | 'my_team'
  | 'shared_with_me'
  | 'unassigned'
  | 'my_inbox'
  | 'inbox'

export interface ListTicketsOptions {
  scope: TicketQueueScope
  permissionSet: PermissionSet
  statusCategory?: TicketStatusCategory
  statusIds?: readonly TicketStatusId[]
  search?: string
  inboxId?: InboxId | null
  organizationId?: OrganizationId | null
  requesterContactId?: ContactId | null
  limit?: number
  offset?: number
  sort?: 'last_activity_desc' | 'created_desc' | 'created_asc'
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export async function listTickets(opts: ListTicketsOptions): Promise<{
  rows: Ticket[]
  total: number
}> {
  const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
  const offset = Math.max(opts.offset ?? 0, 0)
  const set = opts.permissionSet

  const scopeWhere = await buildScopeWhere(opts.scope, set, opts.inboxId ?? null)

  const filters = [isNull(tickets.deletedAt), scopeWhere]
  if (opts.inboxId !== undefined) {
    if (opts.inboxId === null) filters.push(isNull(tickets.inboxId))
    else filters.push(eq(tickets.inboxId, opts.inboxId))
  }
  if (opts.organizationId !== undefined) {
    if (opts.organizationId === null) filters.push(isNull(tickets.organizationId))
    else filters.push(eq(tickets.organizationId, opts.organizationId))
  }
  if (opts.requesterContactId !== undefined) {
    if (opts.requesterContactId === null) filters.push(isNull(tickets.requesterContactId))
    else filters.push(eq(tickets.requesterContactId, opts.requesterContactId))
  }
  if (opts.statusIds?.length) {
    filters.push(inArray(tickets.statusId, opts.statusIds as TicketStatusId[]))
  }
  if (opts.statusCategory) {
    // Resolve category → statusIds via a subquery to avoid a join.
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
  if (opts.search?.trim()) {
    const q = `%${opts.search.trim()}%`
    filters.push(or(ilike(tickets.subject, q), ilike(tickets.descriptionText, q))!)
  }

  const where = and(...filters)
  const orderBy = (() => {
    switch (opts.sort) {
      case 'created_desc':
        return desc(tickets.createdAt)
      case 'created_asc':
        return asc(tickets.createdAt)
      case 'last_activity_desc':
      default:
        return desc(tickets.lastActivityAt)
    }
  })()

  const [rows, [{ count }]] = await Promise.all([
    db.select().from(tickets).where(where).orderBy(orderBy).limit(limit).offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(tickets)
      .where(where),
  ])
  return { rows, total: count }
}

async function buildScopeWhere(
  scope: TicketQueueScope,
  set: PermissionSet,
  inboxId: InboxId | null
) {
  switch (scope) {
    case 'all': {
      if (!hasPermission(set, PERMISSIONS.TICKET_VIEW_ALL)) {
        throw new ForbiddenError(
          'TICKET_SCOPE_DENIED',
          'requires ticket.view_all to use the "all" queue scope'
        )
      }
      return sql`true`
    }
    case 'my_assigned': {
      const allowed =
        hasPermission(set, PERMISSIONS.TICKET_VIEW_ALL) ||
        hasPermission(set, PERMISSIONS.TICKET_VIEW_TEAM) ||
        hasPermission(set, PERMISSIONS.TICKET_VIEW_ASSIGNED)
      if (!allowed) {
        throw new ForbiddenError(
          'TICKET_SCOPE_DENIED',
          'requires ticket.view_assigned to use the "my_assigned" scope'
        )
      }
      return eq(tickets.assigneePrincipalId, set.principalId)
    }
    case 'my_team': {
      if (
        !hasPermission(set, PERMISSIONS.TICKET_VIEW_ALL) &&
        !hasPermission(set, PERMISSIONS.TICKET_VIEW_TEAM)
      ) {
        throw new ForbiddenError(
          'TICKET_SCOPE_DENIED',
          'requires ticket.view_team to use the "my_team" scope'
        )
      }
      const teamIds = teamsWithViewPermission(set, PERMISSIONS.TICKET_VIEW_TEAM)
      if (teamIds.length === 0) {
        // The actor has the workspace-wide grant but no team membership; degrade gracefully.
        return sql`false`
      }
      return or(
        inArray(tickets.primaryTeamId, teamIds as TeamId[]),
        inArray(tickets.assigneeTeamId, teamIds as TeamId[])
      )!
    }
    case 'shared_with_me': {
      if (
        !hasPermission(set, PERMISSIONS.TICKET_VIEW_ALL) &&
        !hasPermission(set, PERMISSIONS.TICKET_VIEW_SHARED)
      ) {
        throw new ForbiddenError(
          'TICKET_SCOPE_DENIED',
          'requires ticket.view_shared to use the "shared_with_me" scope'
        )
      }
      const teamIds = set.teamIds
      if (teamIds.length === 0) return sql`false`
      return inArray(
        tickets.id,
        db
          .select({ id: ticketShares.ticketId })
          .from(ticketShares)
          .where(
            and(inArray(ticketShares.teamId, teamIds as TeamId[]), isNull(ticketShares.revokedAt))
          )
      )
    }
    case 'unassigned': {
      const allowed =
        hasPermission(set, PERMISSIONS.TICKET_VIEW_ALL) ||
        hasPermission(set, PERMISSIONS.TICKET_VIEW_TEAM)
      if (!allowed) {
        throw new ForbiddenError(
          'TICKET_SCOPE_DENIED',
          'requires ticket.view_team to use the "unassigned" scope'
        )
      }
      const base = and(isNull(tickets.assigneePrincipalId), isNull(tickets.assigneeTeamId))!
      if (hasPermission(set, PERMISSIONS.TICKET_VIEW_ALL)) return base
      const teamIds = teamsWithViewPermission(set, PERMISSIONS.TICKET_VIEW_TEAM)
      if (teamIds.length === 0) return sql`false`
      return and(base, inArray(tickets.primaryTeamId, teamIds as TeamId[]))!
    }
    case 'my_inbox': {
      if (!hasPermission(set, PERMISSIONS.INBOX_VIEW)) {
        throw new ForbiddenError(
          'TICKET_SCOPE_DENIED',
          'requires inbox.view to use the "my_inbox" scope'
        )
      }
      return inArray(
        tickets.inboxId,
        db
          .select({ id: inboxMemberships.inboxId })
          .from(inboxMemberships)
          .where(eq(inboxMemberships.principalId, set.principalId))
      )
    }
    case 'inbox': {
      if (!hasPermission(set, PERMISSIONS.INBOX_VIEW)) {
        throw new ForbiddenError(
          'TICKET_SCOPE_DENIED',
          'requires inbox.view to use the "inbox" scope'
        )
      }
      if (!inboxId) {
        throw new ValidationError(
          'TICKET_INBOX_REQUIRED',
          'inboxId is required for the "inbox" scope'
        )
      }
      return eq(tickets.inboxId, inboxId)
    }
    default:
      throw new ValidationError('TICKET_SCOPE_INVALID', `unknown scope ${String(scope)}`)
  }
}

function teamsWithViewPermission(
  set: PermissionSet,
  permission:
    | typeof PERMISSIONS.TICKET_VIEW_TEAM
    | typeof PERMISSIONS.TICKET_VIEW_SHARED
    | typeof PERMISSIONS.TICKET_VIEW_ASSIGNED
): TeamId[] {
  // Workspace-wide grant ⇒ all of the actor's teams qualify.
  if (set.workspacePermissions.has(permission)) return set.teamIds.slice() as TeamId[]
  const out: TeamId[] = []
  for (const [teamId, perms] of set.teamPermissions.entries()) {
    if (perms.has(permission)) out.push(teamId)
  }
  return out
}
