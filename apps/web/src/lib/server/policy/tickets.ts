/**
 * Ticket view authorization (support platform §4.11).
 *
 * Mirrors the `xFilter(actor): SQL` convention of policy/boards.ts
 * (`boardViewFilter`) and policy/posts.ts (`postViewFilter`): a single WHERE
 * predicate that a list query ANDs in, so every reader path resolves ticket
 * visibility the same way. Soft-deleted tickets never surface through it.
 */
import { eq, isNull, sql, type SQL } from 'drizzle-orm'
import { tickets, teamMembers } from '@/lib/server/db'
import { can } from './authorize'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { Actor } from './types'

/**
 * Scalar subquery of the team ids an actor belongs to, over `team_members`.
 * Teams resolve membership team -> principals (teams.service
 * `listTeamMemberPrincipalIds`); there is no reverse principal -> teams lookup,
 * so this is the small correlated-free subquery the §4.11 filters use to stay a
 * pure predicate (no extra round trip). Shared by conversationFilter.
 */
export function teamsForActor(principalId: string): SQL {
  // The WHERE uses drizzle `eq` (not a raw `= ${id}`) so the principal TypeID is
  // run through the column's driver mapping to its stored uuid form.
  return sql`SELECT ${teamMembers.teamId} FROM ${teamMembers} WHERE ${eq(teamMembers.principalId, principalId as never)}`
}

/**
 * SQL predicate for ticket list queries (§4.11 resolution over `tickets`).
 * Branches, in order:
 *
 * 1. Service principals (API keys, MCP, the AI agent) act workspace-wide — ALL
 *    non-deleted tickets. First so a service actor is never narrowed by team
 *    membership; the owner-perms ∩ scopes intersection is applied later at the
 *    call site.
 * 2. `ticket.view_all` (Owner/Admin/Manager presets) -> all non-deleted tickets.
 * 3. `ticket.view` -> tickets assigned to one of the actor's teams OR to the
 *    actor. With no team memberships the team subquery is empty, so this
 *    collapses to assigned-to-me only.
 * 4. Anything else fails closed (no principal, or no ticket.view) -> no rows.
 *
 * Every branch excludes `deleted_at IS NOT NULL`.
 */
export function ticketFilter(actor: Actor): SQL {
  const notDeleted = isNull(tickets.deletedAt)

  // (1) Service principals first — workspace-wide, membership-independent.
  if (actor.principalType === 'service') return sql`${notDeleted}`

  // (2) Workspace-wide viewers.
  if (can(actor, PERMISSIONS.TICKET_VIEW_ALL)) return sql`${notDeleted}`

  // (3)/(4) Below here a scoped viewer needs both ticket.view and an identity;
  // without either they see nothing (anonymous/end-user principals never reach
  // tickets).
  const principalId: string | null = actor.principalId ?? null
  if (!can(actor, PERMISSIONS.TICKET_VIEW) || principalId === null) return sql`false`

  const assignedToMe = eq(tickets.assigneePrincipalId, principalId as never)
  // assignee_team_id IN (my teams). Empty set for a non-member collapses this to
  // false, leaving assigned-to-me only — no separate no-membership branch.
  const assignedToMyTeam = sql`${tickets.assigneeTeamId} IN (${teamsForActor(principalId)})`

  return sql`(${notDeleted} AND (${assignedToMe} OR ${assignedToMyTeam}))`
}
