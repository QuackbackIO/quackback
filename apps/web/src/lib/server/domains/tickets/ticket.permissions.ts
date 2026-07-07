/**
 * Ticket-specific permission helpers built on top of the generic authz layer.
 *
 * Every helper takes a pre-loaded `PermissionSet` plus the ticket-shaped
 * `ResourceScope` and returns a boolean — the service layer composes these
 * into higher-level "can the actor do X?" checks.
 *
 * Keeping these in a single file makes the permission matrix easy to audit
 * and gives tests a single import surface.
 */

import type { PrincipalId, TeamId } from '@quackback/ids'
import { PERMISSIONS } from '../authz'
import type { ResourceScope } from '../authz/authz.scopes'
import {
  hasPermission,
  hasPermissionForResource,
  evaluateTicketView,
  type PermissionSet,
} from '../authz/authz.service'

/** Convert a ticket row + its (optional) shares into the authz scope shape. */
export function toResourceScope(ticket: {
  primaryTeamId: TeamId | null
  assigneePrincipalId: PrincipalId | null
  assigneeTeamId: TeamId | null
  shares?: ReadonlyArray<{ teamId: TeamId; revokedAt: Date | null }>
}): ResourceScope {
  return {
    primaryTeamId: ticket.primaryTeamId,
    assigneePrincipalId: ticket.assigneePrincipalId,
    assigneeTeamId: ticket.assigneeTeamId,
    sharedTeamIds: (ticket.shares ?? []).filter((s) => s.revokedAt == null).map((s) => s.teamId),
  }
}

export function canViewTicket(set: PermissionSet, resource: ResourceScope): boolean {
  return evaluateTicketView(set, resource).inScope
}

export function canReplyPublic(set: PermissionSet, resource: ResourceScope): boolean {
  return hasPermissionForResource(set, PERMISSIONS.TICKET_REPLY_PUBLIC, resource)
}

export function canCommentInternal(set: PermissionSet, resource: ResourceScope): boolean {
  return hasPermissionForResource(set, PERMISSIONS.TICKET_COMMENT_INTERNAL, resource)
}

export function canEditFields(set: PermissionSet, resource: ResourceScope): boolean {
  return hasPermissionForResource(set, PERMISSIONS.TICKET_EDIT_FIELDS, resource)
}

export function canAssign(set: PermissionSet, resource: ResourceScope): boolean {
  if (hasPermission(set, PERMISSIONS.TICKET_ASSIGN_ANY)) return true
  return hasPermissionForResource(set, PERMISSIONS.TICKET_ASSIGN_ANY, resource)
}

export function canAssignSelf(set: PermissionSet, resource: ResourceScope): boolean {
  return (
    canAssign(set, resource) ||
    hasPermissionForResource(set, PERMISSIONS.TICKET_ASSIGN_SELF, resource)
  )
}

export function canShareCrossTeam(set: PermissionSet, resource: ResourceScope): boolean {
  return hasPermissionForResource(set, PERMISSIONS.TICKET_SHARE_CROSS_TEAM, resource)
}

export function canManageParticipants(set: PermissionSet, resource: ResourceScope): boolean {
  return hasPermissionForResource(set, PERMISSIONS.TICKET_MANAGE_PARTICIPANTS, resource)
}
