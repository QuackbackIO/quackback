/**
 * Ticket Subscription Service - per-ticket watchers.
 *
 * One row per (ticket, principal): watch/unwatch flips the row's existence
 * (unsubscribe deletes — the post_subscriptions idiom), mute is a temporary
 * timestamp (muted_until in the future suppresses watcher fan-out; NULL or a
 * past value is active). Provenance lives in `reason`
 * ('requester' | 'assignee' | 'replier' | 'manual'); the first subscribe wins.
 *
 * Authorization is enforced at the caller (server fns / sibling services):
 * this module only answers "who watches this ticket" and flips rows.
 */

import {
  db,
  eq,
  and,
  or,
  lt,
  isNull,
  inArray,
  ticketSubscriptions,
  principal,
  type Transaction,
  type TicketSubscriptionReason,
} from '@/lib/server/db'
import type { TicketId, PrincipalId } from '@quackback/ids'
import { isTeamMember } from '@/lib/shared/roles'
import { ValidationError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'ticket-subscriptions' })

export interface TicketWatchStatus {
  watching: boolean
  reason: TicketSubscriptionReason | null
  mutedUntil: Date | null
}

export interface TicketWatcher {
  principalId: PrincipalId
  reason: TicketSubscriptionReason
  mutedUntil: Date | null
  displayName: string | null
  avatarUrl: string | null
  role: string
}

interface SubscribeOptions {
  /** Pass an existing transaction to run within the same context */
  tx?: Transaction
}

/**
 * SQL predicate: the subscription's mute is absent or already expired (an
 * active watcher for fan-out). The one place the "mute wins" rule is encoded.
 */
function notMuted() {
  return or(isNull(ticketSubscriptions.mutedUntil), lt(ticketSubscriptions.mutedUntil, new Date()))
}

/**
 * Subscribe a principal to a ticket (idempotent — an existing row, muted or
 * not, is left untouched, so the first reason wins).
 */
export async function subscribeToTicket(
  principalId: PrincipalId,
  ticketId: TicketId,
  reason: TicketSubscriptionReason,
  options?: SubscribeOptions
): Promise<void> {
  log.debug({ ticket_id: ticketId, principal_id: principalId, reason }, 'subscribe to ticket')
  const executor = options?.tx ?? db
  await executor
    .insert(ticketSubscriptions)
    .values({ ticketId, principalId, reason })
    .onConflictDoNothing()
}

/**
 * subscribeToTicket that never throws — auto-subscribe is a side effect of a
 * ticket write (assignment, reply) and must never fail the write that triggers
 * it. Failures are logged and swallowed.
 */
export async function safeSubscribeToTicket(
  principalId: PrincipalId,
  ticketId: TicketId,
  reason: TicketSubscriptionReason
): Promise<void> {
  try {
    await subscribeToTicket(principalId, ticketId, reason)
  } catch (error) {
    log.warn(
      { ticket_id: ticketId, principal_id: principalId, reason, error },
      'auto-subscribe failed'
    )
  }
}

/** Unsubscribe a principal from a ticket (row delete). */
export async function unsubscribeFromTicket(
  principalId: PrincipalId,
  ticketId: TicketId
): Promise<void> {
  log.debug({ ticket_id: ticketId, principal_id: principalId }, 'unsubscribe from ticket')
  await db
    .delete(ticketSubscriptions)
    .where(
      and(
        eq(ticketSubscriptions.principalId, principalId),
        eq(ticketSubscriptions.ticketId, ticketId)
      )
    )
}

/** Set or clear a subscription's mute (no-ops when the principal isn't watching). */
function setTicketMute(
  principalId: PrincipalId,
  ticketId: TicketId,
  mutedUntil: Date | null
): Promise<unknown> {
  return db
    .update(ticketSubscriptions)
    .set({ mutedUntil })
    .where(
      and(
        eq(ticketSubscriptions.principalId, principalId),
        eq(ticketSubscriptions.ticketId, ticketId)
      )
    )
}

/**
 * Temporarily mute an existing subscription until the given time. No-ops when
 * the principal isn't watching (mute without a row is meaningless).
 */
export async function muteTicket(
  principalId: PrincipalId,
  ticketId: TicketId,
  until: Date
): Promise<void> {
  log.debug({ ticket_id: ticketId, principal_id: principalId, until }, 'mute ticket')
  await setTicketMute(principalId, ticketId, until)
}

/** Clear a subscription's mute. */
export async function unmuteTicket(principalId: PrincipalId, ticketId: TicketId): Promise<void> {
  log.debug({ ticket_id: ticketId, principal_id: principalId }, 'unmute ticket')
  await setTicketMute(principalId, ticketId, null)
}

/** Watch state for one principal on one ticket. */
export async function getTicketWatchStatus(
  principalId: PrincipalId,
  ticketId: TicketId
): Promise<TicketWatchStatus> {
  const [row] = await db
    .select({
      reason: ticketSubscriptions.reason,
      mutedUntil: ticketSubscriptions.mutedUntil,
    })
    .from(ticketSubscriptions)
    .where(
      and(
        eq(ticketSubscriptions.principalId, principalId),
        eq(ticketSubscriptions.ticketId, ticketId)
      )
    )
    .limit(1)
  if (!row) return { watching: false, reason: null, mutedUntil: null }
  return {
    watching: true,
    reason: row.reason as TicketSubscriptionReason,
    mutedUntil: row.mutedUntil,
  }
}

/**
 * Principals to fan notifications out to: every watcher whose mute is absent
 * or expired. Actor exclusion and role filtering happen in the resolvers.
 */
export async function getTicketWatchersForEvent(ticketId: TicketId): Promise<PrincipalId[]> {
  const rows = await db
    .select({ principalId: ticketSubscriptions.principalId })
    .from(ticketSubscriptions)
    .where(and(eq(ticketSubscriptions.ticketId, ticketId), notMuted()))
  return rows.map((r) => r.principalId)
}

/**
 * Watchers who are team members (admin/member roles), mute-filtered — the
 * recipient set for agent-only signals like internal-note bells. One joined
 * query so requester-watchers are excluded structurally, not by a second pass.
 */
export async function getTicketAgentWatchersForEvent(ticketId: TicketId): Promise<PrincipalId[]> {
  const rows = await db
    .select({ principalId: ticketSubscriptions.principalId })
    .from(ticketSubscriptions)
    .innerJoin(principal, eq(ticketSubscriptions.principalId, principal.id))
    .where(
      and(
        eq(ticketSubscriptions.ticketId, ticketId),
        notMuted(),
        inArray(principal.role, ['admin', 'member'])
      )
    )
  return rows.map((r) => r.principalId)
}

/**
 * Admin-added watcher (reason 'manual'): the target must be a team member —
 * requesters watch through their own portal toggle, and adding an arbitrary
 * end user would let an agent point ticket notifications at someone with no
 * relationship to the ticket.
 */
export async function addManualTicketWatcher(
  targetPrincipalId: PrincipalId,
  ticketId: TicketId
): Promise<void> {
  const [target] = await db
    .select({ role: principal.role })
    .from(principal)
    .where(eq(principal.id, targetPrincipalId))
    .limit(1)
  if (!target || !isTeamMember(target.role)) {
    throw new ValidationError('INVALID_WATCHER', 'Can only add team members as watchers')
  }
  await subscribeToTicket(targetPrincipalId, ticketId, 'manual')
}

/** Full watcher list (principal join) for the admin watch control. */
export async function listTicketWatchers(ticketId: TicketId): Promise<TicketWatcher[]> {
  const rows = await db
    .select({
      principalId: ticketSubscriptions.principalId,
      reason: ticketSubscriptions.reason,
      mutedUntil: ticketSubscriptions.mutedUntil,
      displayName: principal.displayName,
      avatarUrl: principal.avatarUrl,
      role: principal.role,
    })
    .from(ticketSubscriptions)
    .innerJoin(principal, eq(ticketSubscriptions.principalId, principal.id))
    .where(eq(ticketSubscriptions.ticketId, ticketId))
    .orderBy(ticketSubscriptions.createdAt)
  return rows.map((r) => ({ ...r, reason: r.reason as TicketSubscriptionReason }))
}
