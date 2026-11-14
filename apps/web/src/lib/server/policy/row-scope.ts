/**
 * The in-memory form of the inbox scope rule.
 *
 * `conversationFilter` and `ticketFilter` decide which rows a list query
 * returns. Some callers must decide for one row they already hold, many times,
 * without a query each time: the realtime inbox stream checks every frame
 * against each subscriber's cached scope. `rowInScope` is that decision, with
 * the same branches in the same order. `actorTeamIds` stands in for the
 * `team_members` subquery the SQL forms run.
 *
 * It reads owner and team only, never `deletedAt`: the stream must still
 * deliver a ticket's delete frame to the teammates who held it. A per-item
 * read check adds the deleted test in front (`canViewTicket` in tickets.ts).
 * row-scope-parity.test.ts holds this rule and the SQL filters to the same
 * answers for every actor shape.
 */
import type { TeamId } from '@quackback/ids'
import { can } from './authorize'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { isUnscopedService, rowScopePrincipalId, type Actor } from './types'

/** The two inbox item kinds the rule covers. */
export type ScopedResource = 'conversation' | 'ticket'

/** The owner and team of one item, as the scope rule reads them. */
export interface ScopedRow {
  assigneePrincipalId: string | null
  teamId: string | null
}

/** Every key the scope rule reads: a change to any other key cannot move scope. */
export const SCOPE_VIEW_KEYS: readonly PermissionKey[] = [
  PERMISSIONS.CONVERSATION_VIEW,
  PERMISSIONS.CONVERSATION_VIEW_ALL,
  PERMISSIONS.TICKET_VIEW,
  PERMISSIONS.TICKET_VIEW_ALL,
]

const KEYS: Record<ScopedResource, { view: PermissionKey; viewAll: PermissionKey }> = {
  conversation: {
    view: PERMISSIONS.CONVERSATION_VIEW,
    viewAll: PERMISSIONS.CONVERSATION_VIEW_ALL,
  },
  ticket: { view: PERMISSIONS.TICKET_VIEW, viewAll: PERMISSIONS.TICKET_VIEW_ALL },
}

/**
 * Whether `actor`'s scope holds an item with this owner and team. Branches, in
 * order: an unscoped service sees everything; the `view_all` key sees
 * everything; the `view` key sees items assigned to the actor or to one of
 * their teams; anything else sees nothing.
 */
export function rowInScope(
  actor: Actor,
  resource: ScopedResource,
  row: ScopedRow,
  actorTeamIds: ReadonlySet<TeamId | string>
): boolean {
  if (isUnscopedService(actor)) return true
  const keys = KEYS[resource]
  if (can(actor, keys.viewAll)) return true
  const principalId = rowScopePrincipalId(actor)
  if (!can(actor, keys.view) || principalId === null) return false
  if (row.assigneePrincipalId !== null && row.assigneePrincipalId === principalId) return true
  return row.teamId !== null && actorTeamIds.has(row.teamId)
}
