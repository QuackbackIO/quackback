/**
 * Ticket → in-app notification dispatcher.
 *
 * One function per ticket event. Each function:
 *   1. Resolves the candidate recipient set (subscribers ∪ implicit owners).
 *   2. Suppresses the actor (you don't get pinged for your own actions).
 *   3. Filters by `canViewTicket(...)` so we never leak a ticket to someone
 *      who lost permission between subscribe and dispatch.
 *   4. Emits one in-app row per surviving recipient.
 *
 * Every dispatcher is best-effort — wrap calls in `try/catch` at the call
 * site (the write path must not fail because we couldn't notify someone).
 */

import {
  db,
  eq,
  and,
  inArray,
  isNull,
  ticketShares,
  teamMemberships,
  type Ticket,
} from '@/lib/server/db'
import type { TicketId, PrincipalId, ContactId, TeamId } from '@quackback/ids'
import { createNotificationsBatch } from '../notifications/notification.service'
import type { CreateNotificationInput, NotificationType } from '../notifications/notification.types'
import { getSubscribers, type TicketSubscriptionEvent } from './ticket.subscriptions'
import { canViewTicket, toResourceScope } from './ticket.permissions'
import { loadPermissionSet } from '../authz/authz.service'
import { resolvePortalLinkedRecipients, resolvePrincipalsForContacts } from './ticket.recipients'

interface NotifyContext {
  actorPrincipalId: PrincipalId | null
}

interface DispatchOptions extends NotifyContext {
  ticket: Ticket
  /** Recipients to notify — duplicates are deduped before permission check. */
  recipients: ReadonlyArray<PrincipalId>
  type: NotificationType
  title: string
  body?: string
  metadata?: Record<string, unknown>
  /**
   * Principals admitted by ownership instead of RBAC (e.g. portal users
   * reached via `contact_user_links`, or the requester themselves). The
   * staff `canViewTicket` check is bypassed for these — they're already
   * known to have a legitimate relationship to the ticket.
   */
  trustedRecipients?: ReadonlySet<PrincipalId>
}

async function dispatch(options: DispatchOptions): Promise<void> {
  const dedup = new Set<PrincipalId>()
  for (const r of options.recipients) {
    if (options.actorPrincipalId && r === options.actorPrincipalId) continue
    dedup.add(r)
  }
  if (dedup.size === 0) return

  const scope = toResourceScope({
    primaryTeamId: options.ticket.primaryTeamId,
    assigneePrincipalId: options.ticket.assigneePrincipalId,
    assigneeTeamId: options.ticket.assigneeTeamId,
    shares: await loadActiveShares(options.ticket.id as TicketId),
  })

  const allowed: PrincipalId[] = []
  for (const principalId of dedup) {
    if (options.trustedRecipients?.has(principalId)) {
      allowed.push(principalId)
      continue
    }
    try {
      const set = await loadPermissionSet(principalId)
      if (canViewTicket(set, scope)) allowed.push(principalId)
    } catch (err) {
      console.warn('[tickets.notifications] permission check failed for', principalId, err)
    }
  }
  if (allowed.length === 0) return

  const inputs: CreateNotificationInput[] = allowed.map((principalId) => ({
    principalId,
    type: options.type,
    title: options.title,
    body: options.body,
    ticketId: options.ticket.id as TicketId,
    metadata: { ticketId: options.ticket.id, ...(options.metadata ?? {}) },
  }))
  await createNotificationsBatch(inputs)
}

async function loadActiveShares(ticketId: TicketId) {
  const rows = await db
    .select({ teamId: ticketShares.teamId, revokedAt: ticketShares.revokedAt })
    .from(ticketShares)
    .where(and(eq(ticketShares.ticketId, ticketId), isNull(ticketShares.revokedAt)))
  return rows.map((r) => ({ teamId: r.teamId as TeamId, revokedAt: r.revokedAt }))
}

async function gatherSubscribers(
  ticketId: TicketId,
  event: TicketSubscriptionEvent,
  extra: ReadonlyArray<PrincipalId | null | undefined> = []
): Promise<PrincipalId[]> {
  const subs = await getSubscribers(ticketId, event)
  const all = new Set<PrincipalId>(subs)
  for (const id of extra) {
    if (id) all.add(id)
  }
  return Array.from(all)
}

function ticketHeader(ticket: Ticket): string {
  return ticket.subject ?? 'ticket'
}

/**
 * Build the dispatch trust set for ownership-based recipients:
 *   - every portal-linked principal (resolved via `contact_user_links`)
 *   - the requester principal itself (their access is by ownership, not RBAC)
 */
function trustedSetForOwnership(
  ticket: Ticket,
  portalLinked: ReadonlySet<PrincipalId>
): ReadonlySet<PrincipalId> | undefined {
  const requesterId = ticket.requesterPrincipalId as PrincipalId | null
  if (!requesterId && portalLinked.size === 0) return undefined
  const out = new Set<PrincipalId>(portalLinked)
  if (requesterId) out.add(requesterId)
  return out
}

// ---------------------------------------------------------------------------
// Event-specific dispatchers
// ---------------------------------------------------------------------------

export async function notifyTicketCreated(ticket: Ticket, ctx: NotifyContext): Promise<void> {
  // Implicit recipients: requester + assignee (if either differs from actor).
  const portal = await resolvePortalLinkedRecipients(ticket)
  const recipients = await gatherSubscribers(ticket.id as TicketId, 'thread', [
    ticket.requesterPrincipalId as PrincipalId | null,
    ticket.assigneePrincipalId as PrincipalId | null,
    ...portal.principalIds,
  ])
  if (recipients.length === 0) return
  const trusted = trustedSetForOwnership(ticket, portal.portalLinked)
  await dispatch({
    ticket,
    actorPrincipalId: ctx.actorPrincipalId,
    recipients,
    type: 'ticket_thread_added',
    title: `Ticket opened: ${ticketHeader(ticket)}`,
    trustedRecipients: trusted,
  })
}

export async function notifyTicketAssigned(
  ticket: Ticket,
  prevAssigneeId: PrincipalId | null,
  ctx: NotifyContext
): Promise<void> {
  const newAssignee = ticket.assigneePrincipalId as PrincipalId | null
  const subs = await getSubscribers(ticket.id as TicketId, 'assignment')

  // Notify the new assignee (if any) — even if they aren't subscribed yet.
  if (newAssignee) {
    const recipients = Array.from(new Set<PrincipalId>([newAssignee, ...subs]))
    await dispatch({
      ticket,
      actorPrincipalId: ctx.actorPrincipalId,
      recipients,
      type: 'ticket_assigned',
      title: `Assigned to you: ${ticketHeader(ticket)}`,
      metadata: { previousAssigneePrincipalId: prevAssigneeId },
    })
  }

  // Notify the previous assignee that they were unassigned.
  if (prevAssigneeId && prevAssigneeId !== newAssignee) {
    await dispatch({
      ticket,
      actorPrincipalId: ctx.actorPrincipalId,
      recipients: [prevAssigneeId],
      type: 'ticket_unassigned',
      title: `Unassigned: ${ticketHeader(ticket)}`,
      metadata: { newAssigneePrincipalId: newAssignee },
    })
  }
}

export async function notifyTicketStatusChanged(
  ticket: Ticket,
  prevCategory: string | null,
  nextCategory: string,
  ctx: NotifyContext
): Promise<void> {
  const portal = await resolvePortalLinkedRecipients(ticket)
  const recipients = await gatherSubscribers(ticket.id as TicketId, 'status', [
    ticket.requesterPrincipalId as PrincipalId | null,
    ticket.assigneePrincipalId as PrincipalId | null,
    ...portal.principalIds,
  ])
  if (recipients.length === 0) return
  const trusted = trustedSetForOwnership(ticket, portal.portalLinked)
  await dispatch({
    ticket,
    actorPrincipalId: ctx.actorPrincipalId,
    recipients,
    type: 'ticket_status_changed',
    title: `Status: ${ticketHeader(ticket)}`,
    body: `${prevCategory ?? '—'} → ${nextCategory}`,
    metadata: { from: prevCategory, to: nextCategory },
    trustedRecipients: trusted,
  })
}

export async function notifyThreadAdded(
  ticket: Ticket,
  threadId: string,
  audience: 'public' | 'internal' | 'shared_team',
  sharedWithTeamId: TeamId | null,
  ctx: NotifyContext
): Promise<void> {
  const portal = await resolvePortalLinkedRecipients(ticket)
  const baseSubs = await gatherSubscribers(ticket.id as TicketId, 'thread', [
    ticket.requesterPrincipalId as PrincipalId | null,
    ticket.assigneePrincipalId as PrincipalId | null,
    // Portal-linked principals only join the recipient set for public threads;
    // for internal / shared_team they're filtered out below regardless.
    ...(audience === 'public' ? portal.principalIds : []),
  ])

  // Audience-aware filter:
  //   - 'public'      → all subscribers (visibility check happens in dispatch)
  //   - 'internal'    → drop the requester + every portal-linked principal
  //                     (they cannot see internal threads)
  //   - 'shared_team' → same as internal for portal-linked + requester
  const requesterId = ticket.requesterPrincipalId as PrincipalId | null
  const recipients =
    audience === 'public'
      ? baseSubs
      : baseSubs.filter((id) => id !== requesterId && !portal.portalLinked.has(id))

  if (recipients.length === 0) return
  // Only public threads trust portal-linked principals; for non-public the
  // set is empty (they were already filtered out above).
  const trusted =
    audience === 'public' ? trustedSetForOwnership(ticket, portal.portalLinked) : undefined
  await dispatch({
    ticket,
    actorPrincipalId: ctx.actorPrincipalId,
    recipients,
    type: 'ticket_thread_added',
    title: `New reply: ${ticketHeader(ticket)}`,
    metadata: { threadId, audience, sharedWithTeamId },
    trustedRecipients: trusted,
  })
}

export interface ParticipantTarget {
  principalId: PrincipalId | null
  contactId: ContactId | null
}

export async function notifyParticipantAdded(
  ticket: Ticket,
  target: ParticipantTarget,
  ctx: NotifyContext
): Promise<void> {
  const direct = target.principalId
  const linked = target.contactId ? await resolvePrincipalsForContacts([target.contactId]) : []
  // Nothing to notify about — contact had no linked portal users yet.
  if (!direct && linked.length === 0) return
  // Notify the added principal directly + anyone subscribed to participant events.
  const subs = await getSubscribers(ticket.id as TicketId, 'participants')
  const seed: PrincipalId[] = direct ? [direct] : []
  const recipients = Array.from(new Set<PrincipalId>([...seed, ...linked, ...subs]))
  await dispatch({
    ticket,
    actorPrincipalId: ctx.actorPrincipalId,
    recipients,
    type: 'ticket_participant_added',
    title: `Added to ticket: ${ticketHeader(ticket)}`,
    metadata: {
      addedPrincipalId: direct,
      addedContactId: target.contactId,
    },
    trustedRecipients: linked.length > 0 ? new Set(linked) : undefined,
  })
}

export async function notifyParticipantRemoved(
  ticket: Ticket,
  target: ParticipantTarget,
  ctx: NotifyContext
): Promise<void> {
  const direct = target.principalId
  const linked = target.contactId ? await resolvePrincipalsForContacts([target.contactId]) : []
  if (!direct && linked.length === 0) return
  const subs = await getSubscribers(ticket.id as TicketId, 'participants')
  const seed: PrincipalId[] = direct ? [direct] : []
  const recipients = Array.from(new Set<PrincipalId>([...seed, ...linked, ...subs]))
  await dispatch({
    ticket,
    actorPrincipalId: ctx.actorPrincipalId,
    recipients,
    type: 'ticket_participant_removed',
    title: `Removed from ticket: ${ticketHeader(ticket)}`,
    metadata: {
      removedPrincipalId: direct,
      removedContactId: target.contactId,
    },
    trustedRecipients: linked.length > 0 ? new Set(linked) : undefined,
  })
}

async function expandTeamMembers(teamId: TeamId): Promise<PrincipalId[]> {
  const rows = await db
    .select({ principalId: teamMemberships.principalId })
    .from(teamMemberships)
    .where(eq(teamMemberships.teamId, teamId))
  return rows.map((r) => r.principalId as PrincipalId)
}

export async function notifyTicketShared(
  ticket: Ticket,
  teamId: TeamId,
  ctx: NotifyContext
): Promise<void> {
  const teamMembers = await expandTeamMembers(teamId)
  const subs = await getSubscribers(ticket.id as TicketId, 'shares')
  const recipients = Array.from(new Set<PrincipalId>([...teamMembers, ...subs]))
  if (recipients.length === 0) return
  await dispatch({
    ticket,
    actorPrincipalId: ctx.actorPrincipalId,
    recipients,
    type: 'ticket_shared',
    title: `Ticket shared: ${ticketHeader(ticket)}`,
    metadata: { teamId },
  })
}

export async function notifyTicketUnshared(
  ticket: Ticket,
  teamId: TeamId,
  ctx: NotifyContext
): Promise<void> {
  const teamMembers = await expandTeamMembers(teamId)
  const subs = await getSubscribers(ticket.id as TicketId, 'shares')
  const recipients = Array.from(new Set<PrincipalId>([...teamMembers, ...subs]))
  if (recipients.length === 0) return
  await dispatch({
    ticket,
    actorPrincipalId: ctx.actorPrincipalId,
    recipients,
    type: 'ticket_unshared',
    title: `Ticket access revoked: ${ticketHeader(ticket)}`,
    metadata: { teamId },
  })
}

export async function notifyTicketSlaWarning(
  ticket: Ticket,
  kind: string,
  ruleName: string,
  recipients: ReadonlyArray<PrincipalId>
): Promise<void> {
  if (recipients.length === 0) return
  const subs = await getSubscribers(ticket.id as TicketId, 'sla')
  const all = Array.from(new Set<PrincipalId>([...recipients, ...subs]))
  await dispatch({
    ticket,
    actorPrincipalId: null,
    recipients: all,
    type: 'ticket_sla_warning',
    title: `SLA escalation: ${ticketHeader(ticket)}`,
    body: `${ruleName} (${kind.replace(/_/g, ' ')}) escalation triggered.`,
    metadata: { kind, ruleName },
  })
}

export async function notifyTicketSlaBreach(ticket: Ticket, kind: string): Promise<void> {
  const subs = await getSubscribers(ticket.id as TicketId, 'sla', undefined)
  const recipients = Array.from(
    new Set<PrincipalId>([
      ...(ticket.assigneePrincipalId ? [ticket.assigneePrincipalId as PrincipalId] : []),
      ...subs,
    ])
  )
  if (recipients.length === 0) return
  await dispatch({
    ticket,
    actorPrincipalId: null,
    recipients,
    type: 'ticket_sla_breach',
    title: `SLA breached: ${ticketHeader(ticket)}`,
    body: `${kind.replace(/_/g, ' ')} target was missed.`,
    metadata: { kind },
  })
}

// Suppress unused warning for helpers exposed for downstream callers.
void inArray
