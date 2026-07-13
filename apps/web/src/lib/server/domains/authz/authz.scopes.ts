/**
 * Scope evaluation helpers.
 *
 * Many ticketing permissions come in pairs (e.g. `ticket.view_all` vs
 * `ticket.view_team`). The authz service first checks whether the principal
 * holds *any* permission in the family; if they only hold a narrower variant,
 * the scope evaluator decides whether the specific resource falls inside that
 * narrower scope.
 *
 * A `ResourceScope` describes the resource being acted on. For tickets that's
 * the owning team, the assignee, any teams the ticket is shared with, and any
 * organization the requester belongs to.
 */

import type { PrincipalId, TeamId } from '@quackback/ids'

export interface ResourceScope {
  /** Team that primarily owns the resource (e.g. ticket.primary_team_id). */
  primaryTeamId?: TeamId | null
  /** Principal currently assigned (e.g. ticket.assignee_principal_id). */
  assigneePrincipalId?: PrincipalId | null
  /** Team currently assigned (e.g. ticket.assignee_team_id). */
  assigneeTeamId?: TeamId | null
  /** Teams the resource is explicitly shared with. */
  sharedTeamIds?: readonly TeamId[]
}

export interface ActorScope {
  principalId: PrincipalId
  /** Teams the actor belongs to (any role). */
  teamIds: readonly TeamId[]
}

/**
 * Result of a single scope check: whether the actor's narrower permission
 * applies to this resource.
 */
export interface ScopeMatch {
  /** True if the resource is within the actor's allowed scope. */
  inScope: boolean
  /** Why — useful for debugging and for the redaction UX copy. */
  reason: 'assigned' | 'team' | 'shared' | 'all' | 'none'
}

export function matchesAssignedScope(actor: ActorScope, resource: ResourceScope): ScopeMatch {
  if (resource.assigneePrincipalId && resource.assigneePrincipalId === actor.principalId) {
    return { inScope: true, reason: 'assigned' }
  }
  return { inScope: false, reason: 'none' }
}

export function matchesTeamScope(actor: ActorScope, resource: ResourceScope): ScopeMatch {
  if (resource.primaryTeamId && actor.teamIds.includes(resource.primaryTeamId)) {
    return { inScope: true, reason: 'team' }
  }
  if (resource.assigneeTeamId && actor.teamIds.includes(resource.assigneeTeamId)) {
    return { inScope: true, reason: 'team' }
  }
  return { inScope: false, reason: 'none' }
}

export function matchesSharedScope(actor: ActorScope, resource: ResourceScope): ScopeMatch {
  if (!resource.sharedTeamIds?.length) {
    return { inScope: false, reason: 'none' }
  }
  for (const shared of resource.sharedTeamIds) {
    if (actor.teamIds.includes(shared)) {
      return { inScope: true, reason: 'shared' }
    }
  }
  return { inScope: false, reason: 'none' }
}
