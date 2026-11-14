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
 * snapshot predates its routing. A caller that has just read the row itself
 * passes those facts instead.
 *
 * A whole team is judged with at most one read of the people (none when the
 * caller passes their rows), one of the item, one of their permissions
 * (`permissionsForPrincipals`) and one of the item team's membership, never one
 * query per person.
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
import { rowInScope, type ScopedRow } from '@/lib/server/policy/row-scope'
import { canViewTicket, type TicketVisibilityFacts } from '@/lib/server/policy/tickets'
import type { Actor } from '@/lib/server/policy/types'
import { isTeamMember, type Role } from '@/lib/shared/roles'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'recipient-scope' })

/**
 * An inbox item a notice is about. `facts` is its owner and team as the
 * caller just read them at resolve time, in the shape the item's policy check
 * takes; without it the item is read by id.
 */
export type ScopedItemRef =
  | { kind: 'conversation'; id: ConversationId; facts?: ScopedRow }
  | { kind: 'ticket'; id: TicketId; facts?: TicketVisibilityFacts }

/** A person to judge: an id, or the row the caller already holds. */
export type Candidate = PrincipalId | { id: PrincipalId; type: string; role: string }

/** Teammates split by whether their own scope holds the item. Non-teammates are in neither. */
export interface TeammateView {
  /** Teammates among the input who can see the item. */
  visible: Set<PrincipalId>
  /** Teammates among the input who cannot. */
  hidden: Set<PrincipalId>
}

const idOf = (c: Candidate): PrincipalId => (typeof c === 'string' ? c : c.id)

async function readPeople(candidates: readonly Candidate[]) {
  const known = candidates.filter((c) => typeof c !== 'string')
  const unknown = candidates.filter((c): c is PrincipalId => typeof c === 'string')
  const read =
    unknown.length === 0
      ? []
      : await db
          .select({ id: principal.id, type: principal.type, role: principal.role })
          .from(principal)
          .where(inArray(principal.id, unknown))
  return [...known, ...read]
}

async function readFacts(item: ScopedItemRef): Promise<ScopedItemRef['facts'] | null> {
  if (item.facts) return item.facts
  if (item.kind === 'conversation') {
    const [row] = await db
      .select({
        assigneePrincipalId: conversations.assignedAgentPrincipalId,
        teamId: conversations.assignedTeamId,
      })
      .from(conversations)
      .where(eq(conversations.id, item.id))
      .limit(1)
    return row ?? null
  }
  const [row] = await db
    .select({
      assigneePrincipalId: tickets.assigneePrincipalId,
      assigneeTeamId: tickets.assigneeTeamId,
      deletedAt: tickets.deletedAt,
    })
    .from(tickets)
    .where(eq(tickets.id, item.id))
    .limit(1)
  return row ?? null
}

function canSee(
  actor: Actor,
  item: ScopedItemRef,
  facts: NonNullable<ScopedItemRef['facts']>,
  teamIds: Set<TeamId>
): boolean {
  if (item.kind === 'ticket') {
    return canViewTicket(actor, facts as TicketVisibilityFacts, teamIds).allowed
  }
  return rowInScope(actor, 'conversation', facts as ScopedRow, teamIds)
}

const itemTeamOf = (facts: NonNullable<ScopedItemRef['facts']>): TeamId | null =>
  (('teamId' in facts ? facts.teamId : facts.assigneeTeamId) as TeamId | null) ?? null

/**
 * Split the teammates among `candidates` by whether each one's own scope holds
 * the item. A missing item, or a deleted ticket, is hidden from every teammate.
 * The item is read only when there is a teammate to judge.
 */
export async function teammateView(
  item: ScopedItemRef,
  candidates: readonly Candidate[]
): Promise<TeammateView> {
  const view: TeammateView = { visible: new Set(), hidden: new Set() }
  if (candidates.length === 0) return view

  const seen = new Set<PrincipalId>()
  const teammates: Array<{ id: PrincipalId; role: Role }> = []
  for (const p of await readPeople(candidates)) {
    if (seen.has(p.id) || p.type !== 'user' || !isTeamMember(p.role)) continue
    seen.add(p.id)
    teammates.push({ id: p.id, role: p.role as Role })
  }
  if (teammates.length === 0) return view

  const facts = await readFacts(item)
  if (!facts) {
    for (const p of teammates) view.hidden.add(p.id)
    return view
  }

  // The item's one team is the only membership the scope rule can ever need.
  const itemTeam = itemTeamOf(facts)
  const [permissionsById, onItemTeam] = await Promise.all([
    permissionsForPrincipals(teammates),
    itemTeam
      ? db
          .select({ principalId: teamMembers.principalId })
          .from(teamMembers)
          .where(
            and(
              eq(teamMembers.teamId, itemTeam),
              inArray(
                teamMembers.principalId,
                teammates.map((p) => p.id)
              )
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
 * `candidates` cut to the people who may hear about the item, order kept:
 * the teammates whose own scope holds it, plus `requesterPrincipalId` when the
 * caller names the item's requester and they are not a teammate. Every other
 * non-teammate is dropped.
 */
export async function inScopeRecipients(
  item: ScopedItemRef,
  candidates: readonly Candidate[],
  opts: { requesterPrincipalId?: string | null } = {}
): Promise<PrincipalId[]> {
  if (candidates.length === 0) return []
  const view = await teammateView(item, candidates)
  const requester = opts.requesterPrincipalId ?? null
  const unique = [...new Set(candidates.map(idOf))]
  const kept: PrincipalId[] = []
  const dropped: PrincipalId[] = []
  for (const id of unique) {
    const isOther = !view.visible.has(id) && !view.hidden.has(id)
    ;(view.visible.has(id) || (id === requester && isOther) ? kept : dropped).push(id)
  }
  if (dropped.length > 0) {
    log.debug(
      { item_kind: item.kind, item_id: item.id, dropped },
      'recipients outside the item scope dropped'
    )
  }
  return kept
}
