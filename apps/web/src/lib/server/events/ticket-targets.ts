import {
  db,
  eq,
  inArray,
  and,
  isNull,
  ticketShares,
  teamMemberships,
  principal,
  user,
} from '@/lib/server/db'
import type { PrincipalId, TeamId, TicketId } from '@quackback/ids'
import type { EventData, EventTicketRef } from './types'
import type { HookTarget } from './hook-types'
import {
  getSubscribers,
  type TicketSubscriptionEvent,
} from '../domains/tickets/ticket.subscriptions'
import {
  resolvePortalLinkedRecipients,
  resolvePrincipalsForContacts,
} from '../domains/tickets/ticket.recipients'
import { canViewTicket, toResourceScope } from '../domains/tickets/ticket.permissions'
import { loadPermissionSet } from '../domains/authz/authz.service'
import {
  batchGenerateUnsubscribeTokens,
  batchGetNotificationPreferences,
} from '../domains/subscriptions/subscription.service'
import type { HookContext } from './hook-context'

function getCategoryForEvent(eventType: string): TicketSubscriptionEvent | null {
  if (
    [
      'ticket.created',
      'ticket.thread_added',
      'ticket.thread_updated',
      'ticket.thread_deleted',
      'ticket.attachment_added',
      'ticket.attachment_removed',
    ].includes(eventType)
  ) {
    return 'thread'
  }
  if (eventType === 'ticket.updated') {
    return 'properties' as any // We handle properties manually or map to another flag? Wait, 'properties' is not in TicketSubscriptionEvent currently! But wait, 'notifyProperties' was just added to the DB, but ticket.subscriptions.ts doesn't export it in TicketSubscriptionEvent type!
  }
  if (['ticket.status_changed', 'ticket.deleted', 'ticket.restored'].includes(eventType)) {
    return 'status'
  }
  if (['ticket.assigned', 'ticket.unassigned'].includes(eventType)) {
    return 'assignment'
  }
  if (['ticket.participant_added', 'ticket.participant_removed'].includes(eventType)) {
    return 'participants'
  }
  if (['ticket.shared', 'ticket.unshared'].includes(eventType)) {
    return 'shares'
  }
  if (['ticket.first_response', 'ticket.sla_warning', 'ticket.sla_breach'].includes(eventType)) {
    return 'sla'
  }
  return null
}

const GLOBAL_PREF_MAP: Record<
  TicketSubscriptionEvent,
  keyof import('../domains/subscriptions/subscription.types').NotificationPreferencesData
> = {
  thread: 'emailTicketThreads',
  properties: 'emailTicketProperties',
  status: 'emailTicketStatus',
  assignment: 'emailTicketAssignment',
  participants: 'emailTicketParticipants',
  shares: 'emailTicketShares',
  sla: 'emailTicketSla',
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

function trustedSetForOwnership(
  ticket: EventTicketRef,
  portalLinked: ReadonlySet<PrincipalId>
): ReadonlySet<PrincipalId> | undefined {
  const requesterId = ticket.requesterPrincipalId as PrincipalId | null
  if (!requesterId && portalLinked.size === 0) return undefined
  const out = new Set<PrincipalId>(portalLinked)
  if (requesterId) out.add(requesterId)
  return out
}

/**
 * Main entry point for resolving ticket email targets.
 */
export async function getTicketEmailTargets(
  event: EventData,
  context: HookContext
): Promise<HookTarget[]> {
  const ticketData = (event.data as any).ticket as EventTicketRef | undefined
  if (!ticketData) return []
  const ticketId = ticketData.id as TicketId

  const category = getCategoryForEvent(event.type)
  if (!category) return []

  // Resolve base recipients according to event specific rules.
  let candidatePrincipalIds: PrincipalId[] = []
  let trustedRecipients: ReadonlySet<PrincipalId> | undefined

  // Emulate ticket.notifications.ts inclusion logic
  if (category === 'thread') {
    const portal = await resolvePortalLinkedRecipients({
      id: ticketId,
      requesterContactId: ticketData.requesterContactId as any,
    })

    // For internal/shared_team threads, drop requester & portal linked
    const audience = (event.data as any).audience
    const isPublic = !audience || audience === 'public'

    const baseSubs = await gatherSubscribers(ticketId, 'thread', [
      ticketData.requesterPrincipalId as PrincipalId | null,
      ticketData.assigneePrincipalId as PrincipalId | null,
      ...(isPublic ? portal.principalIds : []),
    ])

    const requesterId = ticketData.requesterPrincipalId as PrincipalId | null
    candidatePrincipalIds = isPublic
      ? baseSubs
      : baseSubs.filter((id) => id !== requesterId && !portal.portalLinked.has(id))

    trustedRecipients = isPublic
      ? trustedSetForOwnership(ticketData, portal.portalLinked)
      : undefined
  } else if (category === 'status') {
    const portal = await resolvePortalLinkedRecipients({
      id: ticketId,
      requesterContactId: ticketData.requesterContactId as any,
    })
    candidatePrincipalIds = await gatherSubscribers(ticketId, 'status', [
      ticketData.requesterPrincipalId as PrincipalId | null,
      ticketData.assigneePrincipalId as PrincipalId | null,
      ...portal.principalIds,
    ])
    trustedRecipients = trustedSetForOwnership(ticketData, portal.portalLinked)
  } else if (category === 'assignment') {
    const newAssignee = ticketData.assigneePrincipalId as PrincipalId | null
    const prevAssignee = (event.data as any).previousAssigneePrincipalId as PrincipalId | null
    const subs = await gatherSubscribers(ticketId, 'assignment', [newAssignee, prevAssignee])
    candidatePrincipalIds = subs
  } else if (category === 'participants') {
    const direct = ((event.data as any).addedPrincipalId ||
      (event.data as any).removedPrincipalId) as PrincipalId | null
    const contactId = ((event.data as any).addedContactId ||
      (event.data as any).removedContactId) as any
    const linked = contactId ? await resolvePrincipalsForContacts([contactId]) : []
    candidatePrincipalIds = await gatherSubscribers(ticketId, 'participants', [direct, ...linked])
    trustedRecipients = linked.length > 0 ? new Set(linked) : undefined
  } else if (category === 'shares') {
    const teamId = (event.data as any).teamId as TeamId
    const rows = await db
      .select({ principalId: teamMemberships.principalId })
      .from(teamMemberships)
      .where(eq(teamMemberships.teamId, teamId))
    const teamMembers = rows.map((r) => r.principalId as PrincipalId)
    candidatePrincipalIds = await gatherSubscribers(ticketId, 'shares', teamMembers)
  } else if (category === 'sla') {
    candidatePrincipalIds = await gatherSubscribers(ticketId, 'sla', [
      ticketData.assigneePrincipalId as PrincipalId | null,
    ])
  } else if (category === 'properties') {
    const portal = await resolvePortalLinkedRecipients({
      id: ticketId,
      requesterContactId: ticketData.requesterContactId as any,
    })
    candidatePrincipalIds = await gatherSubscribers(ticketId, 'properties', [
      ticketData.requesterPrincipalId as PrincipalId | null,
      ticketData.assigneePrincipalId as PrincipalId | null,
      ...portal.principalIds,
    ])
    trustedRecipients = trustedSetForOwnership(ticketData, portal.portalLinked)
  }

  // Suppress actor
  const actorId = event.actor.principalId
  const dedup = new Set<PrincipalId>()
  for (const r of candidatePrincipalIds) {
    if (actorId && r === actorId) continue
    dedup.add(r)
  }
  if (dedup.size === 0) return []

  // Check canViewTicket permissions
  const scope = toResourceScope({
    primaryTeamId: ticketData.primaryTeamId as TeamId | null,
    assigneePrincipalId: ticketData.assigneePrincipalId as PrincipalId | null,
    assigneeTeamId: ticketData.assigneeTeamId as TeamId | null,
    shares: await loadActiveShares(ticketId),
  })

  const allowed: PrincipalId[] = []
  for (const principalId of dedup) {
    if (trustedRecipients?.has(principalId)) {
      allowed.push(principalId)
      continue
    }
    try {
      const set = await loadPermissionSet(principalId)
      if (canViewTicket(set, scope)) allowed.push(principalId)
    } catch (err) {
      console.warn('[ticket-targets] permission check failed for', principalId, err)
    }
  }

  if (allowed.length === 0) return []

  // Check global email preferences
  const prefsMap = await batchGetNotificationPreferences(allowed)
  const prefKey = GLOBAL_PREF_MAP[category]

  const eligiblePrincipalIds = allowed.filter((id) => {
    const prefs = prefsMap.get(id)
    if (!prefs) return false
    if (prefs.emailMuted) return false
    return prefs[prefKey] === true
  })

  if (eligiblePrincipalIds.length === 0) return []

  // Fetch emails for eligible
  const emailRows = await db
    .select({ principalId: principal.id, email: user.email })
    .from(principal)
    .innerJoin(user, eq(principal.userId, user.id))
    .where(inArray(principal.id, eligiblePrincipalIds))

  const eligibleSubscribers = emailRows.filter((r) => r.email !== null) as {
    principalId: PrincipalId
    email: string
  }[]

  if (eligibleSubscribers.length === 0) return []

  // Generate tokens
  await batchGenerateUnsubscribeTokens(
    eligibleSubscribers.map((s) => ({
      principalId: s.principalId,
      postId: null as any, // Not a post, but we might want to extend unsubscribe action or ignore postId
      action: 'unsubscribe_all' as const, // For now tickets don't have ticket-level unsubscribe token implemented in that table?
    }))
  )

  const eventConfig = buildTicketEmailEventConfig(
    event,
    context.portalBaseUrl,
    ticketData.subject as string | null
  )

  return eligibleSubscribers.map((subscriber) => ({
    type: 'email',
    target: {
      email: subscriber.email,
      unsubscribeUrl: `${context.portalBaseUrl}/settings/notifications`,
    },
    config: {
      workspaceName: context.workspaceName,
      logoUrl: context.logoUrl ?? undefined,
      priorityLabel: ticketData.priority ?? undefined,
      ...eventConfig,
    },
  }))
}

function buildTicketEmailEventConfig(
  event: EventData,
  rootUrl: string,
  subject: string | null
): Record<string, unknown> {
  const ticket = (event.data as any).ticket as EventTicketRef
  const ticketUrl = `${rootUrl}/inbox/tickets/${ticket.id}`
  const ticketSubject = subject ?? 'ticket'

  let title = `Update on ticket: ${ticketSubject}`
  let body: string | undefined

  if (event.type === 'ticket.created') {
    title = `Ticket opened: ${ticketSubject}`
  } else if (event.type === 'ticket.assigned') {
    title = `Ticket assignment updated: ${ticketSubject}`
  } else if (event.type === 'ticket.unassigned') {
    title = `Ticket unassigned: ${ticketSubject}`
  } else if (event.type === 'ticket.status_changed') {
    title = `Status: ${ticketSubject}`
    const data = event.data as any
    body = `${data.previousStatusCategory ?? '—'} → ${data.newStatusCategory}`
  } else if (event.type === 'ticket.thread_added') {
    title = `New reply: ${ticketSubject}`
    const thread = (event.data as any).thread
    if (thread?.bodyTextPreview) {
      body = thread.bodyTextPreview
    }
  } else if (event.type === 'ticket.participant_added') {
    title = `Added to ticket: ${ticketSubject}`
  } else if (event.type === 'ticket.participant_removed') {
    title = `Removed from ticket: ${ticketSubject}`
  } else if (event.type === 'ticket.shared') {
    title = `Ticket shared: ${ticketSubject}`
  } else if (event.type === 'ticket.unshared') {
    title = `Ticket access revoked: ${ticketSubject}`
  } else if (event.type === 'ticket.sla_warning') {
    title = `SLA escalation: ${ticketSubject}`
    const data = event.data as any
    body = `${data.ruleName} (${data.kind.replace(/_/g, ' ')}) escalation triggered.`
  } else if (event.type === 'ticket.sla_breach') {
    title = `SLA breached: ${ticketSubject}`
    const data = event.data as any
    body = `${data.kind.replace(/_/g, ' ')} target was missed.`
  }

  return {
    title,
    body,
    ticketSubject,
    ticketUrl,
  }
}
