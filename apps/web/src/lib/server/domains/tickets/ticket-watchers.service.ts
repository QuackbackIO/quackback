/**
 * Ticket watchers, the people-facing side: watching a ticket yourself, and a
 * teammate adding or removing someone else. The one service the inbox's server
 * fns, the REST API and the MCP tools all call, so every surface applies the
 * same rules:
 *
 * - Watching yourself is a read-side action: `ticket.view` plus being able to
 *   see the ticket (`assertTicketVisible`), the same as reading it.
 * - Changing someone else's watch is `ticket.assign`, the established "manage
 *   this ticket's people" permission, on a ticket the caller can see.
 * - Only a teammate who can see the ticket can be added. A teammate scoped to
 *   their own and their teams' tickets would otherwise get bells for a ticket
 *   that opens as NotFound for them; customers follow their own tickets.
 *
 * Every hand-made change announces itself once, on a real change only:
 * `ticket.subscriber_added` / `ticket.subscriber_removed` (webhook, plus a bell
 * for the person a teammate added), and, when someone else changed the watch,
 * a `watcher.added` / `watcher.removed` entry on the ticket's timeline.
 * Automatic watches (requester, assignee, replier) stay quiet side effects of
 * the writes that make them, in ticket-subscription.service.ts.
 */
import { db, eq, inArray, principal } from '@/lib/server/db'
import type { PrincipalId, TicketId } from '@quackback/ids'
import { can } from '@/lib/server/policy/authorize'
import type { Actor } from '@/lib/server/policy/types'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { isTeamMember } from '@/lib/shared/roles'
import { ForbiddenError, ValidationError } from '@/lib/shared/errors'
import { listAssignableTeammates } from '@/lib/server/domains/teams'
import { assertTicketVisible } from './ticket.service'
import {
  subscribeToTicket,
  unsubscribeFromTicket,
  listTicketWatchers,
  type TicketWatcher,
} from './ticket-subscription.service'
import { teammateTicketView } from './ticket-visibility'
import { recordTicketActivity } from './ticket-activity.service'
import { emitTicketSubscriberAdded, emitTicketSubscriberRemoved } from './ticket.webhooks'

/** A teammate the watcher picker can offer, and whether they can see the ticket. */
export interface TicketWatcherCandidate {
  principalId: PrincipalId
  name: string | null
  email: string | null
  avatarUrl: string | null
  /** False for a teammate the ticket is hidden from: offered, but not addable. */
  canView: boolean
}

function assertCan(actor: Actor, permission: PermissionKey, action: string): void {
  if (!can(actor, permission)) throw new ForbiddenError('FORBIDDEN', `You cannot ${action}`)
}

function requirePrincipal(actor: Actor): PrincipalId {
  if (!actor.principalId) throw new ForbiddenError('FORBIDDEN', 'You must be signed in')
  return actor.principalId
}

/** The caller's gate for managing other people's watches on one ticket. */
async function assertCanManageWatchers(ticketId: TicketId, actor: Actor) {
  assertCan(actor, PERMISSIONS.TICKET_ASSIGN, "change this ticket's watchers")
  return assertTicketVisible(ticketId, actor)
}

/** Everyone watching the ticket, for a caller who can see it. */
export async function listWatchersOfTicket(
  ticketId: TicketId,
  actor: Actor
): Promise<TicketWatcher[]> {
  assertCan(actor, PERMISSIONS.TICKET_VIEW, "see this ticket's watchers")
  await assertTicketVisible(ticketId, actor)
  return listTicketWatchers(ticketId)
}

/** Start watching a ticket yourself (reason 'manual'). */
export async function watchTicketForSelf(
  ticketId: TicketId,
  actor: Actor
): Promise<{ added: boolean }> {
  assertCan(actor, PERMISSIONS.TICKET_VIEW, 'watch this ticket')
  const self = requirePrincipal(actor)
  const ticket = await assertTicketVisible(ticketId, actor)
  const added = await subscribeToTicket(self, ticketId, 'manual')
  if (added) void emitTicketSubscriberAdded(actor, ticket, self, 'manual')
  return { added }
}

/** Stop watching a ticket yourself. */
export async function unwatchTicketForSelf(
  ticketId: TicketId,
  actor: Actor
): Promise<{ removed: boolean }> {
  assertCan(actor, PERMISSIONS.TICKET_VIEW, 'unwatch this ticket')
  const self = requirePrincipal(actor)
  const ticket = await assertTicketVisible(ticketId, actor)
  const reason = await unsubscribeFromTicket(self, ticketId)
  if (reason) void emitTicketSubscriberRemoved(actor, ticket, self, reason)
  return { removed: reason !== null }
}

/**
 * Add a teammate as a watcher. Refuses anyone who is not a teammate, and a
 * teammate who cannot see the ticket. Adding someone already watching changes
 * nothing (their reason and mute stand) and announces nothing.
 */
export async function addTicketWatcher(
  ticketId: TicketId,
  targetPrincipalId: PrincipalId,
  actor: Actor
): Promise<{ added: boolean }> {
  const ticket = await assertCanManageWatchers(ticketId, actor)

  const [target] = await db
    .select({ type: principal.type, role: principal.role, displayName: principal.displayName })
    .from(principal)
    .where(eq(principal.id, targetPrincipalId))
    .limit(1)
  if (!target || target.type !== 'user' || !isTeamMember(target.role)) {
    throw new ValidationError('INVALID_WATCHER', 'Only teammates can be added as watchers')
  }
  const { visible } = await teammateTicketView(ticketId, [targetPrincipalId])
  if (!visible.has(targetPrincipalId)) {
    throw new ValidationError(
      'WATCHER_CANNOT_SEE_TICKET',
      'This teammate cannot see this ticket, so they cannot watch it'
    )
  }

  const added = await subscribeToTicket(targetPrincipalId, ticketId, 'manual')
  if (added) {
    if (targetPrincipalId !== actor.principalId) {
      recordTicketActivity({
        ticketId,
        principalId: actor.principalId,
        type: 'watcher.added',
        metadata: { watcherPrincipalId: targetPrincipalId, watcherName: target.displayName },
      })
    }
    void emitTicketSubscriberAdded(actor, ticket, targetPrincipalId, 'manual')
  }
  return { added }
}

/**
 * Remove anyone's watch on a ticket: a teammate's, or the requester's (whose
 * status bell and resolution email ride their row, B18). Removing someone who
 * isn't watching is a clean no-op.
 */
export async function removeTicketWatcher(
  ticketId: TicketId,
  targetPrincipalId: PrincipalId,
  actor: Actor
): Promise<{ removed: boolean }> {
  const ticket = await assertCanManageWatchers(ticketId, actor)
  const reason = await unsubscribeFromTicket(targetPrincipalId, ticketId)
  if (reason) {
    if (targetPrincipalId !== actor.principalId) {
      const [target] = await db
        .select({ displayName: principal.displayName })
        .from(principal)
        .where(eq(principal.id, targetPrincipalId))
        .limit(1)
      recordTicketActivity({
        ticketId,
        principalId: actor.principalId,
        type: 'watcher.removed',
        metadata: {
          watcherPrincipalId: targetPrincipalId,
          watcherName: target?.displayName ?? null,
        },
      })
    }
    void emitTicketSubscriberRemoved(actor, ticket, targetPrincipalId, reason)
  }
  return { removed: reason !== null }
}

/**
 * The teammates the watcher picker offers, each marked with whether the ticket
 * is visible to them, so the picker can show a scoped teammate as unavailable
 * rather than let the add fail.
 */
export async function listTicketWatcherCandidates(
  ticketId: TicketId,
  actor: Actor
): Promise<TicketWatcherCandidate[]> {
  await assertCanManageWatchers(ticketId, actor)
  const teammates = (await listAssignableTeammates()).map((t) => ({
    ...t,
    principalId: t.principalId as PrincipalId,
  }))
  const ids = teammates.map((t) => t.principalId)
  const [{ visible }, avatars] = await Promise.all([
    teammateTicketView(ticketId, ids),
    ids.length === 0
      ? Promise.resolve([])
      : db
          .select({ id: principal.id, avatarUrl: principal.avatarUrl })
          .from(principal)
          .where(inArray(principal.id, ids)),
  ])
  const avatarOf = new Map(avatars.map((a) => [a.id, a.avatarUrl]))
  return teammates.map((t) => ({
    principalId: t.principalId,
    name: t.name,
    email: t.email,
    avatarUrl: avatarOf.get(t.principalId) ?? null,
    canView: visible.has(t.principalId),
  }))
}
