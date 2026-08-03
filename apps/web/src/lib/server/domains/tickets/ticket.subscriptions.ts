/**
 * Per-(ticket, principal) subscription service.
 *
 * Subscriptions drive the in-app notification dispatcher (`ticket.notifications`).
 * A row is created automatically when the ticket lifecycle implies the
 * principal "owns" it (assignee / requester / participant) and may also be
 * created manually via the server-fns surface.
 *
 * Manual writes refuse to silently overwrite an `auto_*` source unless the
 * caller passes `force: true`. This preserves user intent across automatic
 * resubscribes (e.g. reassignment).
 */

import {
  db,
  eq,
  and,
  or,
  inArray,
  isNull,
  gt,
  lt,
  desc,
  sql,
  ticketSubscriptions,
  tickets,
  type Transaction,
} from '@/lib/server/db'
import type { TicketId, PrincipalId, TicketSubscriptionId } from '@quackback/ids'
import type { TicketSubscription } from '@/lib/shared/db-types'

export type TicketSubscriptionSource =
  | 'auto_assigned'
  | 'auto_participant'
  | 'auto_team_member'
  | 'manual'

const AUTO_SOURCES: ReadonlySet<TicketSubscriptionSource> = new Set([
  'auto_assigned',
  'auto_participant',
  'auto_team_member',
])

export type TicketSubscriptionEvent =
  | 'thread'
  | 'properties'
  | 'status'
  | 'assignment'
  | 'participants'
  | 'shares'
  | 'sla'

export interface TicketSubscriptionPrefsPatch {
  notifyThreads?: boolean
  notifyProperties?: boolean
  notifyStatus?: boolean
  notifyAssignment?: boolean
  notifyParticipants?: boolean
  notifyShares?: boolean
  notifySla?: boolean
}

export interface SubscribeToTicketInput {
  ticketId: TicketId
  principalId: PrincipalId
  source: TicketSubscriptionSource
  prefs?: TicketSubscriptionPrefsPatch
}

/**
 * UPSERT a subscription. Auto sources only insert (never overwrite an existing
 * row). Manual sources insert-or-update; manual writes can clear `mutedUntil`.
 */
export async function subscribeToTicket(
  input: SubscribeToTicketInput,
  tx?: Transaction
): Promise<TicketSubscription> {
  const executor = tx ?? db
  const isAuto = AUTO_SOURCES.has(input.source)
  const values = {
    ticketId: input.ticketId,
    principalId: input.principalId,
    source: input.source,
    notifyThreads: input.prefs?.notifyThreads ?? true,
    notifyProperties: input.prefs?.notifyProperties ?? true,
    notifyStatus: input.prefs?.notifyStatus ?? true,
    notifyAssignment: input.prefs?.notifyAssignment ?? true,
    notifyParticipants: input.prefs?.notifyParticipants ?? false,
    notifyShares: input.prefs?.notifyShares ?? false,
    notifySla: input.prefs?.notifySla ?? true,
  }
  if (isAuto) {
    // Insert-only; if there is already a (manual or auto) row we keep it.
    const [row] = await executor
      .insert(ticketSubscriptions)
      .values(values)
      .onConflictDoNothing({
        target: [ticketSubscriptions.ticketId, ticketSubscriptions.principalId],
      })
      .returning()
    if (row) return row
    const existing = await getSubscription(input.ticketId, input.principalId, executor)
    if (!existing) {
      throw new Error('subscribeToTicket: row vanished after onConflictDoNothing')
    }
    return existing
  }

  // Manual: replace prefs + clear mute window.
  const [row] = await executor
    .insert(ticketSubscriptions)
    .values({ ...values, mutedUntil: null })
    .onConflictDoUpdate({
      target: [ticketSubscriptions.ticketId, ticketSubscriptions.principalId],
      set: {
        source: 'manual',
        notifyThreads: values.notifyThreads,
        notifyProperties: values.notifyProperties,
        notifyStatus: values.notifyStatus,
        notifyAssignment: values.notifyAssignment,
        notifyParticipants: values.notifyParticipants,
        notifyShares: values.notifyShares,
        notifySla: values.notifySla,
        mutedUntil: null,
        updatedAt: sql`now()`,
      },
    })
    .returning()
  return row
}

export async function unsubscribeFromTicket(
  ticketId: TicketId,
  principalId: PrincipalId,
  tx?: Transaction
): Promise<boolean> {
  const executor = tx ?? db
  const result = await executor
    .delete(ticketSubscriptions)
    .where(
      and(
        eq(ticketSubscriptions.ticketId, ticketId),
        eq(ticketSubscriptions.principalId, principalId)
      )
    )
    .returning({ id: ticketSubscriptions.id })
  return result.length > 0
}

export interface UpdateSubscriptionPrefsInput {
  ticketId: TicketId
  principalId: PrincipalId
  patch: TicketSubscriptionPrefsPatch
  /** When false (default), refuses to overwrite an auto-sourced subscription. */
  force?: boolean
}

/**
 * Patch flags on an existing subscription. By default this refuses to mutate
 * a row whose source is one of the `auto_*` values (the caller would lose
 * the meaning of "I was auto-subscribed because I'm the assignee"). Pass
 * `force: true` to upgrade the row to `source: 'manual'` while applying the patch.
 */
export async function updateSubscriptionPrefs(
  input: UpdateSubscriptionPrefsInput,
  tx?: Transaction
): Promise<TicketSubscription | null> {
  const executor = tx ?? db
  const existing = await getSubscription(input.ticketId, input.principalId, executor)
  if (!existing) return null
  const isAuto = AUTO_SOURCES.has(existing.source as TicketSubscriptionSource)
  if (isAuto && !input.force) return existing

  const patch: Record<string, unknown> = { updatedAt: sql`now()` }
  if (input.patch.notifyThreads !== undefined) patch.notifyThreads = input.patch.notifyThreads
  if (input.patch.notifyProperties !== undefined)
    patch.notifyProperties = input.patch.notifyProperties
  if (input.patch.notifyStatus !== undefined) patch.notifyStatus = input.patch.notifyStatus
  if (input.patch.notifyAssignment !== undefined)
    patch.notifyAssignment = input.patch.notifyAssignment
  if (input.patch.notifyParticipants !== undefined)
    patch.notifyParticipants = input.patch.notifyParticipants
  if (input.patch.notifyShares !== undefined) patch.notifyShares = input.patch.notifyShares
  if (input.patch.notifySla !== undefined) patch.notifySla = input.patch.notifySla
  if (input.force) patch.source = 'manual'

  const [row] = await executor
    .update(ticketSubscriptions)
    .set(patch)
    .where(eq(ticketSubscriptions.id, existing.id))
    .returning()
  return row ?? null
}

export async function muteTicket(
  ticketId: TicketId,
  principalId: PrincipalId,
  until: Date | null,
  tx?: Transaction
): Promise<TicketSubscription | null> {
  const executor = tx ?? db
  const [row] = await executor
    .update(ticketSubscriptions)
    .set({ mutedUntil: until, updatedAt: sql`now()` })
    .where(
      and(
        eq(ticketSubscriptions.ticketId, ticketId),
        eq(ticketSubscriptions.principalId, principalId)
      )
    )
    .returning()
  return row ?? null
}

export async function unmuteTicket(
  ticketId: TicketId,
  principalId: PrincipalId,
  tx?: Transaction
): Promise<TicketSubscription | null> {
  return muteTicket(ticketId, principalId, null, tx)
}

export async function getSubscription(
  ticketId: TicketId,
  principalId: PrincipalId,
  executor: Transaction | typeof db = db
): Promise<TicketSubscription | null> {
  const [row] = await executor
    .select()
    .from(ticketSubscriptions)
    .where(
      and(
        eq(ticketSubscriptions.ticketId, ticketId),
        eq(ticketSubscriptions.principalId, principalId)
      )
    )
    .limit(1)
  return row ?? null
}

const EVENT_TO_FLAG = {
  thread: ticketSubscriptions.notifyThreads,
  properties: ticketSubscriptions.notifyProperties,
  status: ticketSubscriptions.notifyStatus,
  assignment: ticketSubscriptions.notifyAssignment,
  participants: ticketSubscriptions.notifyParticipants,
  shares: ticketSubscriptions.notifyShares,
  sla: ticketSubscriptions.notifySla,
} as const

/**
 * Resolve principal IDs subscribed to a given event-kind for a ticket,
 * filtering out anyone whose mute window covers `now`.
 */
export async function getSubscribers(
  ticketId: TicketId,
  event: TicketSubscriptionEvent,
  tx?: Transaction
): Promise<PrincipalId[]> {
  const executor = tx ?? db
  const flagCol = EVENT_TO_FLAG[event]
  const now = new Date()
  const rows = await executor
    .select({ principalId: ticketSubscriptions.principalId })
    .from(ticketSubscriptions)
    .where(
      and(
        eq(ticketSubscriptions.ticketId, ticketId),
        eq(flagCol, true),
        or(isNull(ticketSubscriptions.mutedUntil), lt(ticketSubscriptions.mutedUntil, now))
      )
    )
  return rows.map((r) => r.principalId as PrincipalId)
}

export interface ListSubscriptionsForPrincipalOptions {
  limit?: number
  cursor?: { createdAt: Date; id: TicketSubscriptionId } | null
}

export async function listSubscriptionsForPrincipal(
  principalId: PrincipalId,
  options: ListSubscriptionsForPrincipalOptions = {}
): Promise<TicketSubscription[]> {
  const { limit = 50, cursor } = options
  const conditions = [eq(ticketSubscriptions.principalId, principalId)]
  if (cursor) {
    conditions.push(
      or(
        lt(ticketSubscriptions.createdAt, cursor.createdAt),
        and(
          eq(ticketSubscriptions.createdAt, cursor.createdAt),
          lt(ticketSubscriptions.id, cursor.id)
        )
      )!
    )
  }
  return db
    .select()
    .from(ticketSubscriptions)
    .where(and(...conditions))
    .orderBy(desc(ticketSubscriptions.createdAt), desc(ticketSubscriptions.id))
    .limit(limit)
}

export async function listSubscribersForTicket(ticketId: TicketId): Promise<TicketSubscription[]> {
  return db
    .select()
    .from(ticketSubscriptions)
    .where(eq(ticketSubscriptions.ticketId, ticketId))
    .orderBy(desc(ticketSubscriptions.createdAt))
}

export interface TicketSubscriptionWithTicketRow extends TicketSubscription {
  ticket: {
    id: TicketId
    subject: string
    statusId: string | null
    priority: string
    channel: string
    updatedAt: Date
  }
}

export async function listSubscriptionsForPrincipalWithTickets(
  principalId: PrincipalId,
  options: ListSubscriptionsForPrincipalOptions = {}
): Promise<TicketSubscriptionWithTicketRow[]> {
  const { limit = 50, cursor } = options
  const conditions = [eq(ticketSubscriptions.principalId, principalId)]
  if (cursor) {
    conditions.push(
      or(
        lt(ticketSubscriptions.createdAt, cursor.createdAt),
        and(
          eq(ticketSubscriptions.createdAt, cursor.createdAt),
          lt(ticketSubscriptions.id, cursor.id)
        )
      )!
    )
  }
  const rows = await db
    .select({
      sub: ticketSubscriptions,
      ticket: {
        id: tickets.id,
        subject: tickets.subject,
        statusId: tickets.statusId,
        priority: tickets.priority,
        channel: tickets.channel,
        updatedAt: tickets.updatedAt,
      },
    })
    .from(ticketSubscriptions)
    .innerJoin(tickets, eq(ticketSubscriptions.ticketId, tickets.id))
    .where(and(...conditions))
    .orderBy(desc(ticketSubscriptions.createdAt), desc(ticketSubscriptions.id))
    .limit(limit)
  return rows.map((r) => ({
    ...r.sub,
    ticket: {
      id: r.ticket.id as TicketId,
      subject: r.ticket.subject,
      statusId: r.ticket.statusId,
      priority: r.ticket.priority,
      channel: r.ticket.channel,
      updatedAt: r.ticket.updatedAt,
    },
  }))
}

/**
 * Best-effort wrapper around `subscribeToTicket` — never throws. Used from
 * write paths where notification setup is incidental to the main operation.
 */
export async function safeSubscribe(input: SubscribeToTicketInput): Promise<void> {
  try {
    await subscribeToTicket(input)
  } catch (err) {
    console.warn('[tickets.subscriptions] safeSubscribe failed', err)
  }
}

// Suppress unused-import warning for helpers exposed for downstream callers.
void inArray
void gt
