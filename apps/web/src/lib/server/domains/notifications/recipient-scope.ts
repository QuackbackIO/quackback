/**
 * Who may hear about an inbox item: the recipient side of the inbox scope rule.
 *
 * A bell or email about a conversation or ticket goes only to the teammates
 * whose own scope holds the item, by the rule the inbox list uses
 * (`rowInScope`, and `canViewTicket` for a ticket, which also hides a deleted
 * one). Anyone who is not a current teammate (a removed teammate now on role
 * `user`, a service principal, another customer) hears only as the item's
 * named requester, and only where the caller names them. So a notice never
 * points a person at an item they would get Not found for.
 *
 * The item's owner and team are read by id here, at resolve time, never taken
 * from an event payload: a payload is a snapshot, and a new conversation's
 * snapshot predates its routing.
 *
 * A whole team is judged with one read of the item, one of the people, one of
 * their permissions (`permissionsForPrincipals`) and one of the item team's
 * membership, never one query per person.
 */
import {
  and,
  conversations,
  db,
  eq,
  inArray,
  principal,
  teamMembers,
  tickets,
} from '@/lib/server/db'
import type { ConversationId, PrincipalId, TeamId, TicketId } from '@quackback/ids'
import { permissionsForPrincipals } from '@/lib/server/policy/permissions'
import { rowInScope } from '@/lib/server/policy/row-scope'
import { canViewTicket } from '@/lib/server/policy/tickets'
import type { Actor } from '@/lib/server/policy/types'
import { isTeamMember, type Role } from '@/lib/shared/roles'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'recipient-scope' })

/** An inbox item a notice is about. */
export type ScopedItemRef =
  { kind: 'conversation'; id: ConversationId } | { kind: 'ticket'; id: TicketId }

/** People split by whether their own scope holds the item. */
export interface TeammateView {
  /** Teammates among the input who can see the item. */
  visible: Set<PrincipalId>
  /** Teammates among the input who cannot. */
  hidden: Set<PrincipalId>
  /** Everyone else in the input (customers, service principals, removed teammates): not judged. */
  others: Set<PrincipalId>
}

interface ItemFacts {
  assigneePrincipalId: string | null
  teamId: string | null
  deletedAt: Date | null
}

async function readItem(item: ScopedItemRef): Promise<ItemFacts | null> {
  if (item.kind === 'conversation') {
    const [row] = await db
      .select({
        assigneePrincipalId: conversations.assignedAgentPrincipalId,
        teamId: conversations.assignedTeamId,
      })
      .from(conversations)
      .where(eq(conversations.id, item.id))
      .limit(1)
    return row ? { ...row, deletedAt: null } : null
  }
  const [row] = await db
    .select({
      assigneePrincipalId: tickets.assigneePrincipalId,
      teamId: tickets.assigneeTeamId,
      deletedAt: tickets.deletedAt,
    })
    .from(tickets)
    .where(eq(tickets.id, item.id))
    .limit(1)
  return row ?? null
}

function canSee(actor: Actor, item: ScopedItemRef, facts: ItemFacts, teamIds: Set<TeamId>) {
  if (item.kind === 'ticket') {
    return canViewTicket(
      actor,
      {
        assigneePrincipalId: facts.assigneePrincipalId,
        assigneeTeamId: facts.teamId,
        deletedAt: facts.deletedAt,
      },
      teamIds
    ).allowed
  }
  return rowInScope(actor, 'conversation', facts, teamIds)
}

/**
 * Split `principalIds` by whether each teammate's own scope holds the item. A
 * missing item, or a deleted ticket, is hidden from every teammate.
 */
export async function teammateView(
  item: ScopedItemRef,
  principalIds: readonly PrincipalId[]
): Promise<TeammateView> {
  const view: TeammateView = { visible: new Set(), hidden: new Set(), others: new Set() }
  const ids = [...new Set(principalIds)]
  if (ids.length === 0) return view

  const [facts, people] = await Promise.all([
    readItem(item),
    db
      .select({ id: principal.id, type: principal.type, role: principal.role })
      .from(principal)
      .where(inArray(principal.id, ids)),
  ])
  const teammates = people
    .filter((p) => p.type === 'user' && isTeamMember(p.role))
    .map((p) => ({ id: p.id as PrincipalId, role: p.role as Role }))
  const teammateIds = new Set(teammates.map((p) => p.id))
  for (const id of ids) if (!teammateIds.has(id)) view.others.add(id)
  if (teammates.length === 0) return view
  if (!facts) {
    for (const p of teammates) view.hidden.add(p.id)
    return view
  }

  // The item's one team is the only membership the scope rule can ever need.
  const itemTeam = facts.teamId as TeamId | null
  const [permissionsById, onItemTeam] = await Promise.all([
    permissionsForPrincipals(teammates),
    itemTeam
      ? db
          .select({ principalId: teamMembers.principalId })
          .from(teamMembers)
          .where(
            and(
              eq(teamMembers.teamId, itemTeam),
              inArray(teamMembers.principalId, [...teammateIds])
            )
          )
          .then((rows) => new Set(rows.map((r) => r.principalId as PrincipalId)))
      : Promise.resolve(new Set<PrincipalId>()),
  ])

  for (const p of teammates) {
    const actor: Actor = {
      principalId: p.id,
      role: p.role,
      principalType: 'user',
      segmentIds: new Set(),
      permissions: permissionsById.get(p.id),
    }
    const teamIds = new Set<TeamId>(itemTeam && onItemTeam.has(p.id) ? [itemTeam] : [])
    ;(canSee(actor, item, facts, teamIds) ? view.visible : view.hidden).add(p.id)
  }
  return view
}

/**
 * `principalIds` cut to the people who may hear about the item, order kept:
 * the teammates whose own scope holds it, plus `requesterPrincipalId` when the
 * caller names the item's requester. Every other non-teammate is dropped.
 */
export async function inScopeRecipients(
  item: ScopedItemRef,
  principalIds: readonly PrincipalId[],
  opts: { requesterPrincipalId?: string | null } = {}
): Promise<PrincipalId[]> {
  if (principalIds.length === 0) return []
  const view = await teammateView(item, principalIds)
  const requester = opts.requesterPrincipalId ?? null
  const kept = [...new Set(principalIds)].filter(
    (id) => view.visible.has(id) || (id === requester && view.others.has(id))
  )
  if (kept.length < principalIds.length) {
    log.debug(
      {
        item_kind: item.kind,
        item_id: item.id,
        dropped: [...new Set(principalIds)].filter((id) => !kept.includes(id)),
      },
      'recipients outside the item scope dropped'
    )
  }
  return kept
}
