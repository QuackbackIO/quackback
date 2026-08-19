/**
 * Conversation list authorization (support platform §4.11).
 *
 * The agent-side visibility predicate over `conversations`, mirroring
 * policy/tickets.ts `ticketFilter` (same service / view_all / team / self
 * resolution). Wired into `conversation.query.ts`'s `listConversationsForAgent`
 * (UNIFIED-INBOX-SPEC.md §3.1/§6): a deliberate behavior change — a bare
 * `conversation.view` holder now sees assigned-to-me-or-my-team only, not
 * every conversation (previously an unwired seam). The single-row read path
 * (the owning visitor, or a conversation.view holder) stays in
 * policy/conversation.ts `canViewConversation`; this predicate is purely the
 * team-inbox row selection and does not encode the visitor-owner branch.
 *
 * Unlike tickets, `conversations` has no soft-delete column, so there is no
 * deleted-row exclusion.
 */
import { eq, sql, type SQL } from 'drizzle-orm'
import { conversations } from '@/lib/server/db'
import { can } from './authorize'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { teamsForActor } from './tickets'
import type { Actor } from './types'

/**
 * SQL predicate for agent-side conversation list queries. Branches, in order:
 *
 * 1. Service principals (API keys, MCP, the AI agent) -> ALL conversations
 *    (workspace-wide, membership-independent). First so a service actor is never
 *    narrowed by team membership.
 * 2. `conversation.view_all` -> all conversations.
 * 3. `conversation.view` -> conversations assigned to one of the actor's teams
 *    OR to the actor. With no team memberships the team subquery is empty, so
 *    this collapses to assigned-to-me only.
 * 4. Anything else fails closed (no principal, or no conversation.view).
 */
export function conversationFilter(actor: Actor): SQL {
  // (1) Service principals first — workspace-wide, membership-independent.
  if (actor.principalType === 'service') return sql`true`

  // (2) Workspace-wide viewers.
  if (can(actor, PERMISSIONS.CONVERSATION_VIEW_ALL)) return sql`true`

  // (3)/(4) A scoped viewer needs both conversation.view and an identity.
  const principalId: string | null = actor.principalId ?? null
  if (!can(actor, PERMISSIONS.CONVERSATION_VIEW) || principalId === null) return sql`false`

  const assignedToMe = eq(conversations.assignedAgentPrincipalId, principalId as never)
  const assignedToMyTeam = sql`${conversations.assignedTeamId} IN (${teamsForActor(principalId)})`

  return sql`(${assignedToMe} OR ${assignedToMyTeam})`
}
