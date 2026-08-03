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
import type { PrincipalId, TeamId, TicketId, UserId } from '@quackback/ids'
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
    return 'properties'
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
  const dedupIds = Array.from(dedup)
  const principalRows = dedupIds.length
    ? await db
        .select({ id: principal.id, userId: principal.userId })
        .from(principal)
        .where(inArray(principal.id, dedupIds))
    : []

  const userIdByPrincipal = new Map<PrincipalId, string>()
  const userIds: string[] = []
  for (const row of principalRows) {
    if (row.userId) {
      userIdByPrincipal.set(row.id as PrincipalId, row.userId)
      userIds.push(row.userId)
    }
  }

  const siblingRows = userIds.length
    ? await db
        .select({ id: principal.id, userId: principal.userId })
        .from(principal)
        .where(inArray(principal.userId, Array.from(new Set(userIds)) as UserId[]))
    : []

  const siblingsByUser = new Map<string, PrincipalId[]>()
  for (const row of siblingRows) {
    if (!row.userId) continue
    const siblings = siblingsByUser.get(row.userId) ?? []
    siblings.push(row.id as PrincipalId)
    siblingsByUser.set(row.userId, siblings)
  }

  const canViewCache = new Map<PrincipalId, boolean>()
  const canPrincipalView = async (principalId: PrincipalId): Promise<boolean> => {
    const cached = canViewCache.get(principalId)
    if (cached !== undefined) return cached
    try {
      const set = await loadPermissionSet(principalId)
      const ok = canViewTicket(set, scope)
      canViewCache.set(principalId, ok)
      return ok
    } catch (err) {
      console.warn('[ticket-targets] permission check failed for', principalId, err)
      canViewCache.set(principalId, false)
      return false
    }
  }

  for (const principalId of dedup) {
    if (trustedRecipients?.has(principalId)) {
      allowed.push(principalId)
      continue
    }

    if (await canPrincipalView(principalId)) {
      allowed.push(principalId)
      continue
    }

    // Some users can own multiple principals; if a subscription points to a
    // sibling principal without ticket grants, accept when any sibling for the
    // same user can view this ticket.
    const userId = userIdByPrincipal.get(principalId)
    if (!userId) continue

    const siblings = siblingsByUser.get(userId) ?? []
    for (const siblingId of siblings) {
      if (siblingId === principalId) continue
      if (await canPrincipalView(siblingId)) {
        allowed.push(principalId)
        break
      }
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
    ticketData.subject as string | null,
    ticketData.statusName ?? ticketData.statusCategory ?? null
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

export function buildTicketEmailEventConfig(
  event: EventData,
  rootUrl: string,
  subject: string | null,
  statusLabel: string | null
): Record<string, unknown> {
  const ticket = (event.data as any).ticket as EventTicketRef
  const ticketUrl = `${rootUrl}/tickets/${ticket.id}`
  const ticketSubject = subject ?? 'ticket'
  const actorName = event.actor.displayName ?? event.actor.email
  const occurredAt = formatDateTime(event.timestamp)
  const details: Array<{ label: string; value: string }> = []
  const contentSections: Array<{
    title: string
    body?: string
    rows?: Array<{ label: string; value: string }>
    tone?: 'default' | 'quote' | 'warning'
  }> = []
  const ticketStatus = statusLabel ? humanize(statusLabel) : undefined
  const priority = ticket.priority ? humanize(ticket.priority) : undefined

  if (ticketStatus) details.push({ label: 'Current status', value: ticketStatus })
  if (priority) details.push({ label: 'Priority', value: priority })
  if (ticket.inboxName) details.push({ label: 'Inbox', value: ticket.inboxName })
  if (ticket.primaryTeamName) details.push({ label: 'Team', value: ticket.primaryTeamName })
  if (ticket.channel) details.push({ label: 'Channel', value: humanize(ticket.channel) })
  if (ticket.visibility) details.push({ label: 'Visibility', value: humanize(ticket.visibility) })
  if (ticket.requesterName || ticket.requesterEmail) {
    details.push({
      label: 'Requester',
      value: formatNameAndEmail(ticket.requesterName, ticket.requesterEmail),
    })
  }

  let title = `Update on ticket: ${ticketSubject}`
  let summary = `There is a new update on this ticket.`
  let eventLabel = 'Ticket updated'
  let quote: string | undefined

  if (event.type === 'ticket.created') {
    title = `Ticket opened: ${ticketSubject}`
    eventLabel = 'Ticket opened'
    summary = `A new ticket was opened in ${ticket.inboxName ?? 'your workspace'}.`
    contentSections.push({
      title: 'Initial ticket content',
      body: formatLongText(ticket.descriptionText, 'No description was provided.'),
      tone: 'quote',
    })
    if (ticket.createdAt) details.push({ label: 'Opened', value: formatDateTime(ticket.createdAt) })
  } else if (event.type === 'ticket.assigned') {
    title = `Ticket assignment updated: ${ticketSubject}`
    eventLabel = 'Assignment changed'
    summary = `The ticket assignment changed.`
    const data = event.data as any
    contentSections.push({
      title: 'Assignment change',
      rows: [
        {
          label: 'Previous assignee',
          value: data.previousAssigneePrincipalId
            ? 'Previous teammate details unavailable'
            : 'None',
        },
        {
          label: 'New assignee',
          value: ticket.assigneeTeamName
            ? ticket.assigneeTeamName
            : data.newAssigneePrincipalId
              ? 'New teammate details unavailable'
              : 'None',
        },
      ],
    })
  } else if (event.type === 'ticket.unassigned') {
    title = `Ticket unassigned: ${ticketSubject}`
    eventLabel = 'Ticket unassigned'
    summary = `The ticket is no longer assigned to an individual teammate.`
    const data = event.data as any
    contentSections.push({
      title: 'Assignment change',
      rows: [
        {
          label: 'Previous assignee',
          value: data.previousAssigneePrincipalId
            ? 'Previous teammate details unavailable'
            : 'None',
        },
        { label: 'New assignee', value: 'Unassigned' },
      ],
    })
  } else if (event.type === 'ticket.status_changed') {
    title = `Status: ${ticketSubject}`
    const data = event.data as any
    eventLabel = 'Status changed'
    const previousStatus = humanize(data.previousStatusCategory ?? 'No status')
    const newStatus = humanize(data.newStatusCategory)
    summary = `This ticket moved from ${previousStatus} to ${newStatus}.`
    contentSections.push({
      title: 'Status change',
      rows: [
        { label: 'Previous status', value: previousStatus },
        { label: 'New status', value: newStatus },
      ],
    })
  } else if (event.type === 'ticket.updated') {
    title = `Ticket details updated: ${ticketSubject}`
    eventLabel = 'Ticket details changed'
    const data = event.data as any
    const changedFields = Array.isArray(data.changedFields) ? data.changedFields : []
    summary = `${changedFields.length || 1} ticket ${changedFields.length === 1 ? 'field was' : 'fields were'} updated.`
    const changeRows: Array<{ label: string; value: string }> = []
    for (const field of changedFields.slice(0, 6)) {
      const diff = data.diff?.[field]
      changeRows.push({
        label: humanize(field),
        value: diff
          ? `${formatDiffValue(field, diff.from)} -> ${formatDiffValue(field, diff.to)}`
          : 'Changed',
      })
    }
    if (changedFields.length > 6) {
      changeRows.push({
        label: 'More changes',
        value: `${changedFields.length - 6} additional fields changed`,
      })
    }
    contentSections.push({
      title: 'Changed fields',
      rows:
        changeRows.length > 0
          ? changeRows
          : [
              {
                label: 'Change',
                value: 'Ticket fields changed, but no diff details were provided.',
              },
            ],
    })
  } else if (event.type === 'ticket.thread_added') {
    title = `New reply: ${ticketSubject}`
    eventLabel = 'New reply'
    const thread = (event.data as any).thread
    summary = thread?.isFromRequester
      ? `The requester replied to this ticket.`
      : `A new reply was added to this ticket.`
    if (thread?.createdAt)
      details.push({ label: 'Reply time', value: formatDateTime(thread.createdAt) })
    if ((event.data as any).audience)
      details.push({ label: 'Audience', value: humanize((event.data as any).audience) })
    quote = thread ? formatThreadBody(thread) : undefined
    contentSections.push({
      title: thread?.isFromRequester ? 'Requester reply' : 'Reply content',
      body: quote ?? 'Reply content was not included in the event payload.',
      tone: 'quote',
    })
  } else if (event.type === 'ticket.thread_updated') {
    title = `Reply updated: ${ticketSubject}`
    eventLabel = 'Reply updated'
    const thread = (event.data as any).thread
    summary = `A reply on this ticket was edited.`
    if (thread?.editedAt) details.push({ label: 'Edited', value: formatDateTime(thread.editedAt) })
    if ((event.data as any).audience)
      details.push({ label: 'Audience', value: humanize((event.data as any).audience) })
    quote = thread ? formatThreadBody(thread) : undefined
    contentSections.push({
      title: 'Updated reply content',
      body: quote ?? 'Updated reply content was not included in the event payload.',
      tone: 'quote',
    })
  } else if (event.type === 'ticket.thread_deleted') {
    title = `Reply removed: ${ticketSubject}`
    eventLabel = 'Reply removed'
    summary = `A reply was removed from this ticket.`
    if ((event.data as any).audience)
      details.push({ label: 'Audience', value: humanize((event.data as any).audience) })
    const thread = (event.data as any).thread
    quote = thread ? formatThreadBody(thread) : undefined
    contentSections.push({
      title: 'Removed reply content',
      body: quote ?? 'Removed reply content was not available in the event payload.',
      tone: 'quote',
    })
  } else if (event.type === 'ticket.participant_added') {
    title = `Added to ticket: ${ticketSubject}`
    eventLabel = 'Participant added'
    summary = `A participant was added to this ticket.`
    const role = (event.data as any).role
    contentSections.push({
      title: 'Participant change',
      rows: [
        { label: 'Participant', value: 'Participant details unavailable' },
        { label: 'Role', value: role ? humanize(role) : 'Not specified' },
      ],
    })
  } else if (event.type === 'ticket.participant_removed') {
    title = `Removed from ticket: ${ticketSubject}`
    eventLabel = 'Participant removed'
    summary = `A participant was removed from this ticket.`
    contentSections.push({
      title: 'Participant change',
      rows: [{ label: 'Participant', value: 'Participant details unavailable' }],
    })
  } else if (event.type === 'ticket.shared') {
    title = `Ticket shared: ${ticketSubject}`
    eventLabel = 'Ticket shared'
    summary = `This ticket was shared with another team.`
    const accessLevel = (event.data as any).accessLevel
    contentSections.push({
      title: 'Share details',
      rows: [
        { label: 'Team', value: 'Team details unavailable' },
        { label: 'Access', value: accessLevel ? humanize(accessLevel) : 'Not specified' },
      ],
    })
  } else if (event.type === 'ticket.unshared') {
    title = `Ticket access revoked: ${ticketSubject}`
    eventLabel = 'Ticket access revoked'
    summary = `A team's access to this ticket was revoked.`
    contentSections.push({
      title: 'Share details',
      rows: [{ label: 'Team', value: 'Team details unavailable' }],
    })
  } else if (event.type === 'ticket.sla_warning') {
    title = `SLA escalation: ${ticketSubject}`
    const data = event.data as any
    eventLabel = 'SLA warning'
    summary = `${data.ruleName} is approaching its ${humanize(data.kind)} target.`
    contentSections.push({
      title: 'SLA details',
      rows: [
        { label: 'SLA rule', value: data.ruleName },
        { label: 'Target', value: humanize(data.kind) },
      ],
      tone: 'warning',
    })
  } else if (event.type === 'ticket.sla_breach') {
    title = `SLA breached: ${ticketSubject}`
    const data = event.data as any
    eventLabel = 'SLA breached'
    summary = `The ${humanize(data.kind)} target was missed.`
    contentSections.push({
      title: 'SLA details',
      rows: [{ label: 'Breached target', value: humanize(data.kind) }],
      tone: 'warning',
    })
  } else if (event.type === 'ticket.first_response') {
    title = `First response sent: ${ticketSubject}`
    eventLabel = 'First response recorded'
    const data = event.data as any
    summary = `This ticket received its first response.`
    contentSections.push({
      title: 'First response',
      rows: [
        { label: 'Recorded at', value: formatDateTime(data.firstResponseAt) },
        { label: 'Response content', value: 'Response body unavailable in the event payload' },
      ],
    })
  } else if (event.type === 'ticket.attachment_added') {
    title = `Attachment added: ${ticketSubject}`
    eventLabel = 'Attachment added'
    const attachment = (event.data as any).attachment
    summary = `${attachment.filename} was attached to this ticket.`
    contentSections.push({
      title: 'Attachment details',
      rows: [
        { label: 'File', value: attachment.filename },
        { label: 'Type', value: attachment.mimeType },
        { label: 'Size', value: formatBytes(attachment.sizeBytes) },
        { label: 'Thread', value: attachment.threadId },
        ...(attachment.publicUrl ? [{ label: 'File URL', value: attachment.publicUrl }] : []),
      ],
    })
  } else if (event.type === 'ticket.attachment_removed') {
    title = `Attachment removed: ${ticketSubject}`
    eventLabel = 'Attachment removed'
    const attachment = (event.data as any).attachment
    summary = `${attachment.filename} was removed from this ticket.`
    contentSections.push({
      title: 'Attachment details',
      rows: [
        { label: 'File', value: attachment.filename },
        { label: 'Thread', value: attachment.threadId },
      ],
    })
  } else if (event.type === 'ticket.deleted') {
    title = `Ticket deleted: ${ticketSubject}`
    eventLabel = 'Ticket deleted'
    summary = `This ticket was deleted.`
    contentSections.push({
      title: 'Deleted ticket content',
      body: formatLongText(ticket.descriptionText, 'No description snapshot was available.'),
      tone: 'quote',
    })
  } else if (event.type === 'ticket.restored') {
    title = `Ticket restored: ${ticketSubject}`
    eventLabel = 'Ticket restored'
    summary = `This ticket was restored.`
    contentSections.push({
      title: 'Restored ticket content',
      body: formatLongText(ticket.descriptionText, 'No description snapshot was available.'),
      tone: 'quote',
    })
  }

  return {
    title,
    body: summary,
    summary,
    eventLabel,
    actorName,
    occurredAt,
    details,
    contentSections,
    quote,
    ticketSubject,
    ticketUrl,
    statusLabel: ticketStatus,
  }
}

function humanize(value: unknown): string {
  if (value == null || value === '') return 'None'
  return String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatNameAndEmail(name?: string | null, email?: string | null): string {
  if (name && email) return `${name} (${email})`
  return name ?? email ?? 'Unknown requester'
}

function formatDiffValue(field: string, value: unknown): string {
  if (value == null || value === '') return 'None'
  if (/status|priority|category|role|access/i.test(field)) return humanize(value)
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return clipWithNotice(String(value), 300)
  }
  return clipWithNotice(JSON.stringify(value), 300)
}

function formatThreadBody(thread: {
  bodyText?: string | null
  bodyTextPreview?: string | null
  bodyTextTruncated?: boolean
}): string {
  const source = thread.bodyText?.trim() || thread.bodyTextPreview?.trim()
  if (!source) return 'Thread content was unavailable.'
  const formatted = formatLongText(source, 'Thread content was unavailable.')
  if (!thread.bodyText && thread.bodyTextTruncated && !formatted.includes('Content truncated')) {
    return `${formatted}\n\nContent truncated in event payload.`
  }
  return formatted
}

function formatLongText(value: string | null | undefined, fallback: string): string {
  const normalized = value?.replace(/\r\n/g, '\n').trim()
  if (!normalized) return fallback
  return clipWithNotice(normalized, 4000)
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size >= 10 || unitIndex === 0 ? Math.round(size) : size.toFixed(1)} ${units[unitIndex]}`
}

function clipWithNotice(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength).trimEnd()}\n\nContent truncated in email.`
}
