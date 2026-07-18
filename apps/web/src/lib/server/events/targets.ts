/**
 * Hook target resolution.
 * Queries database to determine all targets for an event.
 */

import type {
  ConversationId,
  PostId,
  PrincipalId,
  SegmentId,
  TeamId,
  TicketId,
  UserId,
} from '@quackback/ids'
import {
  db,
  eq,
  and,
  inArray,
  isNull,
  principal,
  user,
  posts,
  boards,
  userSegments,
  conversations,
  tickets,
} from '@/lib/server/db'
import { realEmail } from '@/lib/shared/anonymous-email'
import { formatTicketNumber } from '@/lib/shared/tickets'
import { isSupportTicketsEnabled } from '@/lib/server/domains/settings/settings.support'
import { canViewPost, type Actor } from '@/lib/server/policy'
import {
  getSubscribersForEvent,
  batchGetNotificationPreferences,
  batchGenerateUnsubscribeTokens,
  type Subscriber,
  type NotificationEventType,
} from '@/lib/server/domains/subscriptions/subscription.service'
import { shouldNotify } from '@/lib/server/domains/subscriptions/notification-matrix'
import type { HookTarget } from './hook-types'
import { stripHtml, truncate } from './hook-utils'
import { type HookContext } from './hook-context'
import type { EventData, EventActor, PostMergedPayload, PostUnmergedPayload } from './types'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'targets' })

/**
 * Drop subscribers who can't view the post under its current board
 * audience + moderation state. Used by every notification fan-out path
 * (subscriber + @-mention) so an audience flip after the subscription
 * was created doesn't keep leaking content via email/in-app.
 *
 * Fast path: when the post is on a public-audience board AND published,
 * every authenticated subscriber passes — skip the per-principal
 * actor/segment lookup entirely. This is the common case for most
 * workspaces; only the audience-restricted minority pays the per-row
 * cost.
 */
async function filterSubscribersByPostAudience(
  postId: PostId,
  subscribers: Subscriber[]
): Promise<Subscriber[]> {
  if (subscribers.length === 0) return subscribers

  const postRows = await db
    .select({
      moderationState: posts.moderationState,
      principalId: posts.principalId,
      access: boards.access,
    })
    .from(posts)
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .where(and(eq(posts.id, postId), isNull(posts.deletedAt), isNull(boards.deletedAt)))
    .limit(1)

  const post = postRows[0]
  if (!post) {
    // Post was deleted or its board was deleted — drop everyone (no
    // delivery for a target that no longer exists).
    return []
  }

  // Fast path: anonymous-tier view + published post — everyone is in.
  // (anonymous view tier is the access-matrix equivalent of the legacy
  // 'public' audience kind.)
  if (post.access?.view === 'anonymous' && post.moderationState === 'published') {
    return subscribers
  }

  // Batch-load each subscriber's role + segments in one query.
  const principalIds = subscribers.map((s) => s.principalId)
  const principals = await db
    .select({
      id: principal.id,
      role: principal.role,
      type: principal.type,
    })
    .from(principal)
    .where(inArray(principal.id, principalIds))
  const principalMap = new Map(principals.map((p) => [String(p.id), p]))

  const segmentRows = await db
    .select({
      principalId: userSegments.principalId,
      segmentId: userSegments.segmentId,
    })
    .from(userSegments)
    .where(inArray(userSegments.principalId, principalIds))
  const segmentsByPrincipal = new Map<string, Set<SegmentId>>()
  for (const row of segmentRows) {
    const key = String(row.principalId)
    const set = segmentsByPrincipal.get(key) ?? new Set<SegmentId>()
    set.add(row.segmentId as SegmentId)
    segmentsByPrincipal.set(key, set)
  }

  return subscribers.filter((sub) => {
    const principalRow = principalMap.get(String(sub.principalId))
    if (!principalRow) return false
    const actor: Actor = {
      principalId: principalRow.id,
      role: (principalRow.role ?? null) as Actor['role'],
      principalType: principalRow.type as Actor['principalType'],
      segmentIds: segmentsByPrincipal.get(String(sub.principalId)) ?? new Set(),
    }
    return canViewPost(
      actor,
      { moderationState: post.moderationState, principalId: post.principalId },
      { access: post.access }
    ).allowed
  })
}

/**
 * Map system event types to notification event types
 */
function getNotificationEventType(eventType: string): NotificationEventType | null {
  switch (eventType) {
    case 'post.status_changed':
      return 'status_change'
    case 'comment.created':
      return 'comment'
    case 'changelog.published':
      // Use status_change to filter subscribers who want status/progress updates
      return 'status_change'
    default:
      return null
  }
}

/** Events that trigger subscriber email and in-app notifications */
export const SUBSCRIBER_EVENT_TYPES = [
  'post.status_changed',
  'comment.created',
  'changelog.published',
] as const
/** Events that resolve a single mentioned principal as the notification target */
export const MENTION_EVENT_TYPES = ['post.mentioned'] as const
/**
 * Get all hook targets for an event.
 * Gracefully handles errors - returns empty array on failure.
 */
export async function getHookTargets(event: EventData): Promise<HookTarget[]> {
  try {
    // WO-18 cutover: the resolver registry is the single resolution path. This
    // adapter reconstructs the DomainEvent from the legacy EventData and
    // delegates. Everything the old if-ladder did now lives in a resolver
    // (integration/webhook/notification/ai/summary), each independently tested.
    //
    // Dynamic imports break the load-time cycle: this module's notification
    // builders are imported BY the notification resolver, so a static import of
    // the registry here would evaluate that resolver (and its top-level
    // `new Set(SUBSCRIBER_EVENT_TYPES)`) before this module finished loading.
    //
    // 'workflow' targets are excluded — the legacy path never emitted workflow
    // HOOK targets (workflows dispatch via their own branch); the flag-off
    // processEvent still does, so including them here would double-dispatch.
    const [{ registerAllResolvers, resolveTargets }, { extractEntityId }, { getEventDefinition }] =
      await Promise.all([import('./resolvers'), import('./outbox-dispatch'), import('./catalogue')])
    registerAllResolvers()

    const domainEvent = {
      eventId: event.id,
      seq: 0n,
      type: event.type,
      entityType: getEventDefinition(event.type)?.entity ?? 'unknown',
      entityId: extractEntityId(event),
      actorType: event.actor.type === 'user' ? 'user' : 'service',
      actorId: event.actor.principalId,
      payload: event.data,
      context: { depth: 0 },
      schemaVersion: 1,
      occurredAt: new Date(event.timestamp),
    } as unknown as import('./envelope').DomainEvent

    // WO-18: the resolver registry is the single resolution path. next's
    // "move bell onto message.created / ticket.status_changed" work
    // (getMessageCreatedTargets / getTicketStatusChangedTargets) is wired into
    // the notification resolver's BELL routing, so it lands here too.
    //
    // bestEffort: this adapter's documented contract is graceful degradation (a
    // broken sink yields zero targets, never a throw). The relay is the caller
    // that wants strict all-or-retry semantics, and it calls resolveTargets
    // directly.
    const targets = await resolveTargets(domainEvent, { bestEffort: true })
    return targets.filter((t) => t.type !== 'workflow')
  } catch (error) {
    log.error({ err: error, event_type: event.type }, 'failed to resolve targets')
    return [] // Graceful degradation - don't crash event processing
  }
}

// WO-18: integration target resolution moved to resolvers/integration.resolver.ts
// (getIntegrationTargets / getCachedIntegrationMappings deleted here).

/**
 * Get email and in-app notification targets for subscribers.
 * Fetches subscribers once, then builds both email and notification targets.
 */
export async function getSubscriberTargets(
  event: EventData,
  context: HookContext
): Promise<HookTarget[]> {
  const postId = extractPostId(event)
  if (!postId) return []

  const notifEventType = getNotificationEventType(event.type)
  if (!notifEventType) return []

  // Fetch subscribers ONCE for both email and notification targets
  const subscribers = await getSubscribersForEvent(postId, notifEventType)
  log.debug(
    { count: subscribers.length, notif_event_type: notifEventType, post_id: postId },
    'found subscribers for event'
  )
  if (subscribers.length === 0) return []

  // Filter out the actor (don't notify yourself)
  let nonActorSubscribers = subscribers.filter(
    (subscriber) => !isActorSubscriber(subscriber, event.actor)
  )
  if (nonActorSubscribers.length === 0) return []

  // Audience filter: drop subscribers who no longer have view access to
  // the post (board audience changed, post was moderated, etc.). Without
  // this, a user who subscribed while the board was public keeps
  // receiving comment / status notifications — including post title and
  // comment preview in the email body — after the board flips to
  // team-only or segments. The in-app list-view redaction (round 2) only
  // catches reads; the email itself is the leak.
  nonActorSubscribers = await filterSubscribersByPostAudience(postId, nonActorSubscribers)
  if (nonActorSubscribers.length === 0) return []

  // For private comments, only notify team member subscribers
  if (event.type === 'comment.created' && event.data.comment.isPrivate) {
    nonActorSubscribers = await filterToTeamMembers(nonActorSubscribers)
    if (nonActorSubscribers.length === 0) return []
  }

  const targets: HookTarget[] = []

  // Email targets: further filter by global email preferences
  const emailTargets = await buildEmailTargets(event, nonActorSubscribers, postId, context)
  targets.push(...emailTargets)

  // Notification targets: all non-actor subscribers get in-app notifications
  const notificationTarget = await buildNotificationTarget(event, nonActorSubscribers, context)
  if (notificationTarget) {
    targets.push(notificationTarget)
  }

  return targets
}

/**
 * Build email hook targets from pre-filtered subscribers.
 */
async function buildEmailTargets(
  event: EventData,
  subscribers: Subscriber[],
  postId: PostId,
  context: HookContext
): Promise<HookTarget[]> {
  const eventConfig = await buildEmailEventConfig(event, context.portalBaseUrl)
  if (!eventConfig) return []

  // Batch get notification preferences (single query instead of N queries)
  const principalIds = subscribers.map((s) => s.principalId)
  const prefsMap = await batchGetNotificationPreferences(principalIds)

  // Filter by per-type x per-channel notification preferences
  const notificationType = EVENT_TO_NOTIFICATION_TYPE[event.type]
  const eligibleSubscribers = subscribers.filter((subscriber) => {
    const prefs = prefsMap.get(subscriber.principalId)
    return prefs && notificationType && shouldNotify(prefs, notificationType, 'email')
  })
  if (eligibleSubscribers.length === 0) return []

  // Batch generate unsubscribe tokens (single insert instead of N inserts)
  const tokenMap = await batchGenerateUnsubscribeTokens(
    eligibleSubscribers.map((s) => ({
      principalId: s.principalId,
      postId,
      action: 'unsubscribe_post' as const,
    }))
  )

  return eligibleSubscribers.map((subscriber) => ({
    type: 'email',
    target: {
      email: subscriber.email,
      unsubscribeUrl: `${context.portalBaseUrl}/unsubscribe?token=${tokenMap.get(subscriber.principalId)}`,
    },
    config: {
      workspaceName: context.workspaceName,
      logoUrl: context.logoUrl ?? undefined,
      preferencesUrl: `${context.portalBaseUrl}/settings/preferences`,
      ...eventConfig,
    },
  }))
}

/**
 * Extract post ID from event data.
 */
function extractPostId(event: EventData): PostId | null {
  if ('post' in event.data) {
    return event.data.post.id as PostId
  }
  if ('duplicatePost' in event.data) {
    return event.data.duplicatePost.id as PostId
  }
  return null
}

/**
 * Check if subscriber is the actor (don't notify yourself).
 */
function isActorSubscriber(subscriber: Subscriber, actor: EventActor): boolean {
  if (actor.type === 'service') return false
  // principalId is the primary match: it survives the DomainEvent round-trip
  // (the envelope carries actorId=principalId but not email/userId), so the
  // "don't notify yourself" filter works identically whether the event came
  // through the legacy full-actor path or the resolver registry. For a real
  // user, principalId maps 1:1 to userId, so this is behaviour-preserving.
  if (actor.principalId && subscriber.principalId === actor.principalId) return true
  return subscriber.userId === actor.userId || subscriber.email === actor.email
}

/**
 * Map system event types to notification preference-matrix type keys.
 * `buildEmailTargets` only ever sees `post.status_changed` and
 * `comment.created` (changelog/status/mention have their own paths below),
 * but the map is kept generic for clarity.
 */
const EVENT_TO_NOTIFICATION_TYPE: Record<string, string> = {
  'post.status_changed': 'post_status_changed',
  'comment.created': 'comment_created',
}

/**
 * Filter subscribers to only team members (admin/member roles).
 * Batch queries the principal table for efficiency.
 */
async function filterToTeamMembers(subscribers: Subscriber[]): Promise<Subscriber[]> {
  if (subscribers.length === 0) return []

  const principalIds = subscribers.map((s) => s.principalId)
  const principals = await db.query.principal.findMany({
    where: inArray(principal.id, principalIds as PrincipalId[]),
    columns: { id: true, role: true },
  })

  const teamPrincipalIds = new Set(principals.filter((p) => p.role !== 'user').map((p) => p.id))

  return subscribers.filter((s) => teamPrincipalIds.has(s.principalId as PrincipalId))
}

/**
 * Check if actor is a team member (non-user role).
 */
async function isActorTeamMember(actor: EventActor): Promise<boolean> {
  // Service principals: resolve by principalId directly
  if (actor.principalId) {
    const record = await db.query.principal.findFirst({
      where: eq(principal.id, actor.principalId as PrincipalId),
      columns: { role: true },
    })
    return record?.role !== 'user'
  }
  if (!actor.userId) return false
  const record = await db.query.principal.findFirst({
    where: eq(principal.userId, actor.userId as UserId),
    columns: { role: true },
  })
  return record?.role !== 'user'
}

/**
 * Build a post URL from base URL and post reference.
 */
function buildPostUrl(rootUrl: string, post: { boardSlug: string; id: string }): string {
  return `${rootUrl}/b/${post.boardSlug}/posts/${post.id}`
}

/**
 * Resolve a display name for a comment author.
 */
function resolveCommenterName(comment: { authorName?: string; authorEmail?: string }): string {
  return comment.authorName || comment.authorEmail?.split('@')[0] || 'Someone'
}

/**
 * Build event-specific email config.
 */
async function buildEmailEventConfig(
  event: EventData,
  rootUrl: string
): Promise<Record<string, unknown> | null> {
  if (event.type === 'post.status_changed') {
    const { post, previousStatus, newStatus } = event.data
    return {
      postTitle: post.title,
      postUrl: buildPostUrl(rootUrl, post),
      previousStatus,
      newStatus,
    }
  }

  if (event.type === 'comment.created') {
    const { comment, post } = event.data
    return {
      postTitle: post.title,
      postUrl: `${buildPostUrl(rootUrl, post)}#comment-${comment.id}`,
      commenterName: resolveCommenterName(comment),
      commentPreview: truncate(stripHtml(comment.content), 200),
      isTeamMember: await isActorTeamMember(event.actor),
    }
  }

  return null
}

/**
 * Build a single in-app notification target from pre-filtered subscribers.
 */
async function buildNotificationTarget(
  event: EventData,
  subscribers: Subscriber[],
  context: HookContext
): Promise<HookTarget | null> {
  const config = await buildNotificationConfig(event, context.portalBaseUrl)
  if (!config) return null

  return {
    type: 'notification',
    target: {
      principalIds: subscribers.map((s) => s.principalId),
    },
    config,
  }
}

/**
 * Build notification-specific config from event.
 */
async function buildNotificationConfig(
  event: EventData,
  rootUrl: string
): Promise<Record<string, unknown> | null> {
  if (event.type === 'post.status_changed') {
    const { post, previousStatus, newStatus } = event.data
    return {
      postId: post.id,
      postTitle: post.title,
      boardSlug: post.boardSlug,
      postUrl: buildPostUrl(rootUrl, post),
      previousStatus,
      newStatus,
    }
  }

  if (event.type === 'comment.created') {
    const { comment, post } = event.data
    return {
      postId: post.id,
      postTitle: post.title,
      boardSlug: post.boardSlug,
      postUrl: `${buildPostUrl(rootUrl, post)}#comment-${comment.id}`,
      commentId: comment.id,
      commenterName: resolveCommenterName(comment),
      commentPreview: truncate(stripHtml(comment.content), 200),
      isTeamMember: await isActorTeamMember(event.actor),
    }
  }

  return null
}

// ============================================================================
// Mention Targets
// ============================================================================

/** Principal roles that are eligible to receive mention notifications */
const MENTION_ELIGIBLE_ROLES = new Set(['admin', 'member', 'user'])

/**
 * Resolve hook targets for a `post.mentioned` event.
 *
 * The event payload carries a single `mentionedPrincipalId`. We look up that
 * principal (left-joined to user for email), apply defensive type/role
 * filtering so anonymous and service principals never get notified, and
 * return:
 *  - one notification target (always, when the principal exists and is eligible)
 *  - one email target (only when the joined user has a non-null email)
 */
export async function getMentionTargets(
  event: EventData,
  context: HookContext
): Promise<HookTarget[]> {
  if (event.type !== 'post.mentioned') return []

  const { mentionedPrincipalId, postTitle, postUrl } = event.data
  if (!mentionedPrincipalId) return []

  const rows = await db
    .select({
      id: principal.id,
      type: principal.type,
      role: principal.role,
      email: user.email,
    })
    .from(principal)
    .leftJoin(user, eq(principal.userId, user.id))
    .where(eq(principal.id, mentionedPrincipalId as PrincipalId))
    .limit(1)

  const row = rows[0]
  if (!row) return []

  // Defensive: only human-user principals with an eligible role get mention notifications.
  // Anonymous principals don't have a stable inbox to deliver to; service principals
  // are integrations/API keys, not humans. The role check is belt-and-suspenders for
  // the same reason.
  if (row.type !== 'user' || !MENTION_ELIGIBLE_ROLES.has(row.role)) return []

  // Audience filter: the mentioned principal must be able to see the
  // post under its board's current audience. Without this, an admin can
  // @-mention a portal user from a team-only post and that user gets
  // an email with the team-only post title in the subject.
  const postIdForCheck = event.data.postId as PostId
  const allowedIds = await filterSubscribersByPostAudience(postIdForCheck, [
    {
      principalId: row.id as PrincipalId,
      // The remaining fields don't matter for the audience check —
      // canViewPost only reads role + principalType + segmentIds.
      userId: '',
      email: row.email ?? '',
      name: null,
      reason: 'manual',
      notifyComments: false,
      notifyStatusChanges: false,
    },
  ])
  if (allowedIds.length === 0) return []

  const targets: HookTarget[] = []

  targets.push({
    type: 'notification',
    target: { principalIds: [row.id as PrincipalId] },
    config: {
      postId: event.data.postId,
      postTitle,
      postUrl,
      eventType: 'post.mentioned',
    },
  })

  if (row.email) {
    // Honour the per-type x per-channel preference matrix (this subsumes the
    // global emailMuted kill switch). Without this, a user who hit
    // unsubscribe-all (which sets emailMuted=true) would still get direct
    // mention emails because the mention path doesn't go through the
    // subscriber filter that runs shouldNotify.
    const prefsMap = await batchGetNotificationPreferences([row.id as PrincipalId])
    const prefs = prefsMap.get(row.id as PrincipalId)
    if (!prefs || shouldNotify(prefs, 'post_mentioned', 'email')) {
      const tokenMap = await batchGenerateUnsubscribeTokens([
        {
          principalId: row.id as PrincipalId,
          postId: event.data.postId as PostId,
          action: 'unsubscribe_all',
        },
      ])
      const token = tokenMap.get(row.id as PrincipalId)
      targets.push({
        type: 'email',
        target: {
          email: row.email,
          unsubscribeUrl: token ? `${context.portalBaseUrl}/unsubscribe?token=${token}` : undefined,
        },
        config: {
          postTitle,
          postUrl,
          workspaceName: context.workspaceName,
          logoUrl: context.logoUrl ?? undefined,
          preferencesUrl: `${context.portalBaseUrl}/settings/preferences`,
          eventType: 'post.mentioned',
        },
      })
    }
  }

  return targets
}

// ============================================================================
// Support-Inbox Assignment + Hand-off Targets (WO-3 slice 1)
// ============================================================================

/**
 * Notification target for `conversation.assigned`: the newly-assigned agent
 * AND, when the conversation's team assignment changed, that team's members
 * — one combined target (never split recipients across multiple notification
 * targets; idempotency depends on a single target per event), mirroring
 * `getTicketAssignedTargets` below. An assignment can move the agent and/or
 * the team independently (conversation.service's assignTeam can touch
 * `assignedTeamId` while leaving the agent untouched, and vice versa), so
 * each side only contributes recipients when IT actually changed.
 * `buildNotifications` (events/handlers/notification.ts) tells the two
 * recipient kinds apart by comparing each principal against
 * `assignedAgentPrincipalId` in config, so the direct assignee gets "you were
 * assigned" while their teammates get the team-assignment copy. Exported
 * (like `webhookSubscriptionMatches`) so it's unit-testable without driving
 * the whole getHookTargets pipeline.
 */
export async function getConversationAssignedTargets(event: EventData): Promise<HookTarget | null> {
  if (event.type !== 'conversation.assigned') return null
  const {
    conversation,
    assignedAgentPrincipalId,
    previousAgentPrincipalId,
    assignedTeamId,
    previousTeamId,
  } = event.data

  const directAssignee: PrincipalId | null =
    assignedAgentPrincipalId &&
    assignedAgentPrincipalId !== previousAgentPrincipalId &&
    assignedAgentPrincipalId !== event.actor.principalId
      ? (assignedAgentPrincipalId as PrincipalId)
      : null

  const recipients = new Set<PrincipalId>()
  if (directAssignee) recipients.add(directAssignee)

  if (assignedTeamId && assignedTeamId !== previousTeamId) {
    const { listTeamMemberPrincipalIds } = await import('@/lib/server/domains/teams')
    const memberIds = await listTeamMemberPrincipalIds(assignedTeamId as TeamId)
    for (const id of memberIds) {
      if (id !== event.actor.principalId) recipients.add(id)
    }
  }

  if (recipients.size === 0) return null
  return {
    type: 'notification',
    target: { principalIds: [...recipients] },
    config: { conversationId: conversation.id, assignedAgentPrincipalId: directAssignee },
  }
}

/**
 * Notification target for `ticket.assigned`: the newly-assigned teammate AND,
 * when the ticket's team assignment changed, that team's members — one
 * combined target (never split recipients across multiple notification
 * targets; idempotency depends on a single target per event).
 * `buildNotifications` (events/handlers/notification.ts) tells the two
 * recipient kinds apart by comparing each principal against
 * `assignedPrincipalId` in config, so the direct assignee gets "you were
 * assigned" while their teammates get the team-assignment copy.
 */
/**
 * The two recipient kinds of a `ticket.assigned` event: the direct assignee
 * (only when the agent actually changed and isn't the actor) and the members of
 * a newly-assigned team (actor-excluded). Shared by the bell builder above and
 * the email builder below so the recipient rule lives in ONE place — the bell
 * derives per-recipient copy by comparing against `assignedPrincipalId`, the
 * email bakes a per-target `kind`, but both start from this same set.
 */
async function computeTicketAssignmentRecipients(
  data: {
    assignedPrincipalId: string | null
    previousPrincipalId: string | null
    assignedTeamId: string | null
    previousTeamId: string | null
  },
  actorPrincipalId: string | undefined
): Promise<{ directAssignee: PrincipalId | null; teamMemberIds: PrincipalId[] }> {
  const directAssignee: PrincipalId | null =
    data.assignedPrincipalId &&
    data.assignedPrincipalId !== data.previousPrincipalId &&
    data.assignedPrincipalId !== actorPrincipalId
      ? (data.assignedPrincipalId as PrincipalId)
      : null

  let teamMemberIds: PrincipalId[] = []
  if (data.assignedTeamId && data.assignedTeamId !== data.previousTeamId) {
    const { listTeamMemberPrincipalIds } = await import('@/lib/server/domains/teams')
    const memberIds = await listTeamMemberPrincipalIds(data.assignedTeamId as TeamId)
    teamMemberIds = memberIds.filter((id) => id !== actorPrincipalId)
  }
  return { directAssignee, teamMemberIds }
}

export async function getTicketAssignedTargets(event: EventData): Promise<HookTarget | null> {
  if (event.type !== 'ticket.assigned') return null
  const { ticket, assignedPrincipalId, previousPrincipalId, assignedTeamId, previousTeamId } =
    event.data

  const { directAssignee, teamMemberIds } = await computeTicketAssignmentRecipients(
    { assignedPrincipalId, previousPrincipalId, assignedTeamId, previousTeamId },
    event.actor.principalId
  )

  const recipients = new Set<PrincipalId>()
  if (directAssignee) recipients.add(directAssignee)
  for (const id of teamMemberIds) recipients.add(id)

  if (recipients.size === 0) return null
  return {
    type: 'notification',
    target: { principalIds: [...recipients] },
    config: { ticketId: ticket.id, assignedPrincipalId: directAssignee },
  }
}

/**
 * Notification target for `assistant.handed_off`. The payload carries only
 * `{ conversationId, reason }`, so this re-reads the conversation for its
 * current team assignment — the assigned team's members when one is set,
 * else every admin/member principal (the whole agent team). The actor
 * (Quinn's service principal) is always excluded.
 */
export async function getAssistantHandedOffTargets(event: EventData): Promise<HookTarget | null> {
  if (event.type !== 'assistant.handed_off') return null
  const { conversationId, reason } = event.data

  const [conv] = await db
    .select({ assignedTeamId: conversations.assignedTeamId })
    .from(conversations)
    .where(eq(conversations.id, conversationId as ConversationId))
    .limit(1)

  let recipientIds: PrincipalId[]
  if (conv?.assignedTeamId) {
    const { listTeamMemberPrincipalIds } = await import('@/lib/server/domains/teams')
    recipientIds = await listTeamMemberPrincipalIds(conv.assignedTeamId as TeamId)
  } else {
    const { listAssignableTeammates } = await import('@/lib/server/domains/teams')
    recipientIds = (await listAssignableTeammates()).map((t) => t.principalId as PrincipalId)
  }

  const filtered = recipientIds.filter((id) => id !== event.actor.principalId)
  if (filtered.length === 0) return null
  return {
    type: 'notification',
    target: { principalIds: filtered },
    config: { conversationId, reason },
  }
}

/**
 * Notification target for `conversation.note_mentioned` (WO-3 slice 3):
 * `mentionedPrincipalIds` is already eligibility-filtered (team-only) and
 * author-excluded by the emit site (sync-conversation-mentions.ts), so this
 * resolver trusts the payload outright — no DB round-trip, unlike the other
 * resolvers above. Exported (like its siblings) for direct unit testing.
 */
export function getConversationNoteMentionedTargets(event: EventData): HookTarget | null {
  if (event.type !== 'conversation.note_mentioned') return null
  const { conversationId, conversationMessageId, mentionedPrincipalIds, authorName, preview } =
    event.data
  if (mentionedPrincipalIds.length === 0) return null
  return {
    type: 'notification',
    target: { principalIds: mentionedPrincipalIds as PrincipalId[] },
    config: { conversationId, conversationMessageId, authorName, preview },
  }
}

/**
 * Notification target for `ticket.status_changed` (WO-3 slice 4, extended
 * for watchers): the requester ∪ the ticket's watchers, in ONE combined
 * target (single-target invariant, see getTicketAssignedTargets). Fires only
 * when the new stage is non-null and differs from the previous stage (a
 * same-stage or null-stage move stays silent for EVERYONE — the requester
 * must never see internal status names, and agent watchers get stage moves,
 * not churn). Watchers are actor-excluded; the requester keeps the original
 * unconditional bell semantics. Stage labels are resolved HERE, not carried
 * in the payload, so a later workspace label edit doesn't retroactively
 * change historical event data.
 */
/**
 * Active watchers to notify for a ticket event, actor-excluded. `agentsOnly`
 * narrows to team-member watchers (internal-note recipients). Dynamic import
 * avoids a static cycle through the tickets domain.
 */
async function actorExcludedTicketWatchers(
  ticketId: TicketId,
  actorPrincipalId: string | undefined,
  opts?: { agentsOnly?: boolean }
): Promise<PrincipalId[]> {
  const { getTicketWatchersForEvent, getTicketAgentWatchersForEvent } =
    await import('@/lib/server/domains/tickets/ticket-subscription.service')
  const watchers = opts?.agentsOnly
    ? await getTicketAgentWatchersForEvent(ticketId)
    : await getTicketWatchersForEvent(ticketId)
  return watchers.filter((id) => id !== actorPrincipalId)
}

export async function getTicketStatusChangedTargets(event: EventData): Promise<HookTarget | null> {
  if (event.type !== 'ticket.status_changed') return null
  const { ticket, stage, previousStage, requesterPrincipalId, title } = event.data
  if (!stage || stage === previousStage) return null

  const recipients = new Set<PrincipalId>(
    await actorExcludedTicketWatchers(ticket.id as TicketId, event.actor.principalId)
  )
  if (requesterPrincipalId) recipients.add(requesterPrincipalId as PrincipalId)
  if (recipients.size === 0) return null

  const { getStageLabels } = await import('@/lib/server/domains/settings/settings.tickets')
  const stageLabels = await getStageLabels()
  const stageLabel = stageLabels[stage as keyof typeof stageLabels] ?? stage
  const previousStageLabel = previousStage
    ? (stageLabels[previousStage as keyof typeof stageLabels] ?? previousStage)
    : null

  return {
    type: 'notification',
    target: { principalIds: [...recipients] },
    config: {
      ticketId: ticket.id,
      title,
      stageLabel,
      previousStageLabel,
      requesterPrincipalId: (requesterPrincipalId as string | undefined) ?? null,
    },
  }
}

/**
 * Notification target for `ticket.replied`: everyone watching the ticket
 * (ticket_subscriptions; the service already drops active mutes) minus the
 * actor, in ONE combined target. An agent reply bells the
 * requester-as-watcher plus agent watchers; a requester reply bells agent
 * watchers (the requester is the actor, excluded).
 */
export async function getTicketRepliedTargets(event: EventData): Promise<HookTarget | null> {
  if (event.type !== 'ticket.replied') return null
  const { ticket, content, senderType, title, authorName, requesterPrincipalId } = event.data

  const recipients = await actorExcludedTicketWatchers(
    ticket.id as TicketId,
    event.actor.principalId
  )
  if (recipients.length === 0) return null

  return {
    type: 'notification',
    target: { principalIds: recipients },
    config: {
      ticketId: ticket.id,
      title,
      authorName: authorName ?? (senderType === 'visitor' ? 'The requester' : 'A teammate'),
      preview: truncate(content, 140),
      requesterPrincipalId: requesterPrincipalId ?? null,
    },
  }
}

/**
 * Notification target for `ticket.note_added`: watching TEAM MEMBERS only —
 * a requester-watcher is structurally excluded by the role filter, so an
 * internal note can never leak to a customer through the watcher path.
 * Actor excluded.
 */
export async function getTicketNoteAddedTargets(event: EventData): Promise<HookTarget | null> {
  if (event.type !== 'ticket.note_added') return null
  const { ticket, content, title, authorName } = event.data

  const recipients = await actorExcludedTicketWatchers(
    ticket.id as TicketId,
    event.actor.principalId,
    {
      agentsOnly: true,
    }
  )
  if (recipients.length === 0) return null

  return {
    type: 'notification',
    target: { principalIds: recipients },
    config: {
      ticketId: ticket.id,
      title,
      authorName: authorName ?? 'A teammate',
      preview: truncate(content, 140),
    },
  }
}

/**
 * Notification target for `ticket.external_status_changed`: agent watchers
 * only (the requester never hears about tracker plumbing — customer-facing
 * resolution flows through the mapped ticket.status_changed stage crossing).
 * The actor is the integration's service principal; exclusion is a no-op
 * unless that principal somehow watches the ticket.
 */
export async function getTicketExternalStatusChangedTargets(
  event: EventData
): Promise<HookTarget | null> {
  if (event.type !== 'ticket.external_status_changed') return null
  const {
    ticket,
    title,
    integrationType,
    externalDisplayId,
    externalUrl,
    externalStatus,
    transition,
  } = event.data

  const recipients = await actorExcludedTicketWatchers(
    ticket.id as TicketId,
    event.actor.principalId,
    { agentsOnly: true }
  )
  if (recipients.length === 0) return null

  return {
    type: 'notification',
    target: { principalIds: recipients },
    config: {
      ticketId: ticket.id,
      title,
      integrationType,
      reference: externalDisplayId,
      url: externalUrl,
      externalStatus,
      transition,
    },
  }
}

/**
 * Notification target for `message.created` (WO-3 slice 5, the riskiest
 * move — reproduces `notifyVisitorMessage`'s deleted team-bell block
 * EXACTLY): only a VISITOR-sent message bells the team. Recipients are every
 * admin/member principal — the SAME raw query notifyVisitorMessage used
 * (role-only, no `principal.type` filter), not `listAssignableTeammates`,
 * which additionally requires `type: 'user'` and would silently narrow the
 * recipient set. The anti-spam presence gate is NOT applied here — it runs
 * in the notification hook itself (events/handlers/notification.ts), since
 * `isAnyAgentOnline` is a single global Redis check, not a per-recipient one,
 * and the hook is where the config's `isFirstMessage` flag is read back out.
 */
export async function getMessageCreatedTargets(event: EventData): Promise<HookTarget | null> {
  if (event.type !== 'message.created') return null
  if (event.data.message.senderType !== 'visitor') return null

  const team = await db
    .select({ principalId: principal.id })
    .from(principal)
    .where(inArray(principal.role, ['admin', 'member']))
  if (team.length === 0) return null

  const authorName = event.data.message.authorName ?? 'A visitor'
  return {
    type: 'notification',
    target: { principalIds: team.map((t) => t.principalId as PrincipalId) },
    config: {
      conversationId: event.data.conversation.id,
      authorName,
      preview: truncate(event.data.message.content, 140),
      isFirstMessage: event.data.isFirstMessage,
    },
  }
}

// ============================================================================
// Ticket + SLA lifecycle email targets (support platform)
//
// Five exported builders returning `type: 'email'` HookTargets, one target per
// recipient (the relay derives an idempotent per-recipient job id, so this is
// redrain-safe). Unlike the bells above — one target, copy derived per principal
// in the notification handler — email targets bake `kind` + a per-audience
// `ctaUrl` into each target's TicketEmailConfig, so the email hook stays a dumb
// switch. All builders take the HookContext for portalBaseUrl/workspaceName/
// logoUrl and ride the notification preference matrix (shouldNotify, which
// subsumes the global emailMuted kill switch). See scratchpad plan D3/D4/D6/D8.
// ============================================================================

/** Portal thread deep link for a requester-facing ticket email. */
function ticketPortalUrl(portalBaseUrl: string, ticketId: string): string {
  return `${portalBaseUrl}/support/ticket/${ticketId}`
}

/** Agent inbox deep link (tickets + conversations both select by `?i=`). */
function inboxUrl(portalBaseUrl: string, id: string): string {
  return `${portalBaseUrl}/admin/inbox?i=${id}`
}

/**
 * Resolve a deliverable email for each principal id (account email →
 * principal-level contactEmail, the resolveReplyRecipient precedence), dropping
 * synthetic-anon placeholders and principals with no real address. One joined
 * query for the whole set.
 */
async function resolvePrincipalEmails(
  principalIds: PrincipalId[]
): Promise<Map<PrincipalId, string>> {
  const out = new Map<PrincipalId, string>()
  if (principalIds.length === 0) return out
  const rows = await db
    .select({ id: principal.id, email: user.email, contactEmail: principal.contactEmail })
    .from(principal)
    .leftJoin(user, eq(principal.userId, user.id))
    .where(inArray(principal.id, principalIds))
  for (const row of rows) {
    const email = realEmail(row.email) ?? realEmail(row.contactEmail)
    if (email) out.set(row.id as PrincipalId, email)
  }
  return out
}

/**
 * The subset of `principalIds` whose stored preferences allow email for the
 * given matrix key. A principal with no preferences row defaults to allowed
 * (the matrix default is on — see notification-matrix.ts), matching the
 * changelog/status email paths.
 */
async function filterByEmailPreference(
  principalIds: PrincipalId[],
  matrixKey: string
): Promise<Set<PrincipalId>> {
  if (principalIds.length === 0) return new Set()
  const prefsMap = await batchGetNotificationPreferences(principalIds)
  return new Set(
    principalIds.filter((id) => {
      const prefs = prefsMap.get(id)
      return prefs ? shouldNotify(prefs, matrixKey, 'email') : true
    })
  )
}

/** Ticket facts re-read from the row when the payload doesn't carry them. */
async function readTicketFacts(ticketId: TicketId): Promise<{
  requesterPrincipalId: PrincipalId | null
  title: string
  assignedTeamId: TeamId | null
} | null> {
  const [row] = await db
    .select({
      requesterPrincipalId: tickets.requesterPrincipalId,
      title: tickets.title,
      assigneeTeamId: tickets.assigneeTeamId,
    })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1)
  if (!row) return null
  return {
    requesterPrincipalId: (row.requesterPrincipalId as PrincipalId | null) ?? null,
    title: row.title,
    assignedTeamId: (row.assigneeTeamId as TeamId | null) ?? null,
  }
}

function ticketEmailTarget(email: string, config: Record<string, unknown>): HookTarget {
  return { type: 'email', target: { email, unsubscribeUrl: '' }, config }
}

type TicketEmailKind =
  | 'created'
  | 'reply'
  | 'status_resolved'
  | 'assigned'
  | 'assigned_team'
  | 'sla_warning'
  | 'sla_breach'

interface BaseTicketConfigParams {
  kind: TicketEmailKind
  ticketId?: TicketId
  ticketLabel: string
  title: string
  ctaUrl: string
  context: HookContext
  messageBody?: string
  authorName?: string
  statusChange?: { previousLabel: string | null; newLabel: string }
}

/** The TicketEmailConfig fields every kind shares; the two audience wrappers
 *  below spread this and add only their audience-specific fields, so a new
 *  shared field is added in one place. */
function baseTicketConfig(params: BaseTicketConfigParams): Record<string, unknown> {
  return {
    kind: params.kind,
    workspaceName: params.context.workspaceName,
    logoUrl: params.context.logoUrl ?? undefined,
    preferencesUrl: `${params.context.portalBaseUrl}/settings/preferences`,
    ticketLabel: params.ticketLabel,
    title: params.title,
    ticketId: params.ticketId,
    ctaUrl: params.ctaUrl,
    messageBody: params.messageBody,
    authorName: params.authorName,
    statusChange: params.statusChange,
  }
}

/**
 * Requester-facing config: per-team From (resolveSendingAddress) and, when an
 * inbound-capable email channel is configured, a signed per-ticket Reply-To for
 * reply-by-email (D8/D9). Both are null-safe — absent means branded EMAIL_FROM
 * and a portal-only footer.
 */
async function requesterFacingConfig(
  params: BaseTicketConfigParams & { ticketId: TicketId; assignedTeamId: TeamId | null }
): Promise<Record<string, unknown>> {
  const { resolveSendingAddress } =
    await import('@/lib/server/domains/channel-accounts/channel-account.service')
  const { inboundTicketReplyToAddress } =
    await import('@/lib/server/domains/conversation/conversation.email-channel')
  const from = (await resolveSendingAddress(params.assignedTeamId, 'support')) ?? undefined
  const replyTo = inboundTicketReplyToAddress(params.ticketId) ?? undefined
  return { ...baseTicketConfig(params), from, replyTo }
}

/** Agent-facing config: branded EMAIL_FROM, no reply-by-email, inbox CTA. */
function agentFacingConfig(
  params: BaseTicketConfigParams & { clockLabel?: string; dueLabel?: string }
): Record<string, unknown> {
  return { ...baseTicketConfig(params), clockLabel: params.clockLabel, dueLabel: params.dueLabel }
}

/**
 * One target per recipient, routing the requester to requesterFacingConfig
 * (portal CTA, per-team From, reply-by-email) and every other watcher to
 * agentFacingConfig (inbox CTA, branded From). Shared by the replied + resolved
 * builders, whose only differences are `kind` and the carried facts.
 */
async function buildRequesterOrAgentTargets(params: {
  recipients: PrincipalId[]
  emailMap: Map<PrincipalId, string>
  requesterPrincipalId: PrincipalId | null
  kind: 'reply' | 'status_resolved'
  ticketId: TicketId
  ticketLabel: string
  title: string
  assignedTeamId: TeamId | null
  context: HookContext
  messageBody?: string
  authorName?: string
  statusChange?: { previousLabel: string | null; newLabel: string }
}): Promise<HookTarget[]> {
  const { recipients, emailMap, requesterPrincipalId, context } = params
  const facts = {
    kind: params.kind,
    ticketId: params.ticketId,
    ticketLabel: params.ticketLabel,
    title: params.title,
    messageBody: params.messageBody,
    authorName: params.authorName,
    statusChange: params.statusChange,
  }
  const targets: HookTarget[] = []
  for (const id of recipients) {
    const email = emailMap.get(id)!
    const config =
      requesterPrincipalId != null && id === requesterPrincipalId
        ? await requesterFacingConfig({
            ...facts,
            ctaUrl: ticketPortalUrl(context.portalBaseUrl, params.ticketId),
            assignedTeamId: params.assignedTeamId,
            context,
          })
        : agentFacingConfig({
            ...facts,
            ctaUrl: inboxUrl(context.portalBaseUrl, params.ticketId),
            context,
          })
    targets.push(ticketEmailTarget(email, config))
  }
  return targets
}

/**
 * `ticket.created` → a single confirmation email to the requester. Uniquely,
 * the actor is NOT excluded (the filer is exactly who gets the ack), and this is
 * direct-to-requester, never watcher-sourced. Gated on the support-tickets flag,
 * a resolvable non-synthetic requester address, and the `ticket_created` matrix
 * key.
 */
export async function getTicketCreatedEmailTargets(
  event: EventData,
  context: HookContext
): Promise<HookTarget[]> {
  if (event.type !== 'ticket.created') return []
  if (!(await isSupportTicketsEnabled())) return []

  const t = event.data.ticket
  // Only a `customer` ticket is a requester-facing thread; internal ticket types
  // (back_office/tracker) can carry a requesterPrincipalId but must never send
  // that person a customer confirmation + reply-by-email address — the symmetric
  // guard to the inbound `tkt-` path's `ticket.type !== 'customer'` drop.
  if ((t.type as string) !== 'customer') return []
  const ticketId = t.id as TicketId
  let requesterPrincipalId = (t.requesterPrincipalId as string | null | undefined) ?? null
  let title = (t.title as string | undefined) ?? null
  let assignedTeamId = (t.assignedTeamId as string | null | undefined) ?? null

  if (!requesterPrincipalId || title == null) {
    const facts = await readTicketFacts(ticketId)
    if (!facts) return []
    requesterPrincipalId = requesterPrincipalId ?? facts.requesterPrincipalId
    title = title ?? facts.title
    assignedTeamId = assignedTeamId ?? facts.assignedTeamId
  }
  if (!requesterPrincipalId || title == null) return []

  const requester = requesterPrincipalId as PrincipalId
  const emailMap = await resolvePrincipalEmails([requester])
  const email = emailMap.get(requester)
  if (!email) return []

  const eligible = await filterByEmailPreference([requester], 'ticket_created')
  if (!eligible.has(requester)) return []

  const config = await requesterFacingConfig({
    kind: 'created',
    ticketId,
    ticketLabel: formatTicketNumber(t.number),
    title,
    ctaUrl: ticketPortalUrl(context.portalBaseUrl, ticketId),
    assignedTeamId: (assignedTeamId as TeamId | null) ?? null,
    context,
  })
  return [ticketEmailTarget(email, config)]
}

/**
 * `ticket.replied` (agent reply only) → the ticket's watcher set minus the
 * actor, filtered by email preference. Each recipient gets kind `reply` with the
 * full reply body; the requester's target is requester-facing (portal CTA,
 * per-team From, reply-by-email), agent watchers get the inbox CTA and branded
 * From (D3 sequencing note).
 */
export async function getTicketRepliedEmailTargets(
  event: EventData,
  context: HookContext
): Promise<HookTarget[]> {
  if (event.type !== 'ticket.replied') return []
  const { ticket, content, senderType, title, authorName, requesterPrincipalId } = event.data
  if (senderType !== 'agent') return []
  if (!(await isSupportTicketsEnabled())) return []
  // Internal (back-office/tracker) tickets never email their nominal requester
  // a portal CTA or reply-by-email address — same gate as the created builder;
  // agent watchers still get their inbox-facing emails below.
  const emailableRequester =
    (ticket.type as string) === 'customer'
      ? ((requesterPrincipalId as string | null | undefined) ?? null)
      : null

  const ticketId = ticket.id as TicketId
  const { getTicketWatchersForEvent } =
    await import('@/lib/server/domains/tickets/ticket-subscription.service')
  const watchers = (await getTicketWatchersForEvent(ticketId)).filter(
    (id) => id !== event.actor.principalId
  )
  if (watchers.length === 0) return []

  const [emailMap, eligible] = await Promise.all([
    resolvePrincipalEmails(watchers),
    filterByEmailPreference(watchers, 'ticket_replied'),
  ])
  const recipients = watchers.filter((id) => emailMap.has(id) && eligible.has(id))
  if (recipients.length === 0) return []

  const assignedTeamId = ((ticket.assignedTeamId as string | null | undefined) ??
    null) as TeamId | null

  return buildRequesterOrAgentTargets({
    recipients,
    emailMap,
    requesterPrincipalId: emailableRequester as PrincipalId | null,
    kind: 'reply',
    ticketId,
    ticketLabel: formatTicketNumber(ticket.number),
    title,
    assignedTeamId,
    context,
    messageBody: content,
    authorName: authorName ?? undefined,
  })
}

/**
 * `ticket.status_changed` → a resolution email, but only on a genuine category
 * crossing INTO `closed` (deliberately narrower than the bell, which fires on
 * any public stage crossing; both ride the `ticket_status_changed` matrix key).
 * Recipients = the watcher set minus the actor, with the requester included
 * unconditionally (matching the bell's semantics). Stage labels resolve at build
 * time via getStageLabels.
 */
export async function getTicketResolvedEmailTargets(
  event: EventData,
  context: HookContext
): Promise<HookTarget[]> {
  if (event.type !== 'ticket.status_changed') return []
  const { ticket, previousStatus, newStatus, stage, previousStage, requesterPrincipalId, title } =
    event.data
  if (!(newStatus === 'closed' && previousStatus !== 'closed')) return []
  if (!(await isSupportTicketsEnabled())) return []

  // Same customer-type gate as the created/replied builders: internal tickets
  // never email their nominal requester (agent watchers keep theirs).
  const emailableRequester =
    (ticket.type as string) === 'customer'
      ? ((requesterPrincipalId as string | null | undefined) ?? null)
      : null

  const ticketId = ticket.id as TicketId
  const { getTicketWatchersForEvent } =
    await import('@/lib/server/domains/tickets/ticket-subscription.service')
  const recipientIds = new Set<PrincipalId>(
    (await getTicketWatchersForEvent(ticketId)).filter((id) => id !== event.actor.principalId)
  )
  if (emailableRequester) recipientIds.add(emailableRequester as PrincipalId)
  if (recipientIds.size === 0) return []

  const ids = [...recipientIds]
  const [emailMap, eligible] = await Promise.all([
    resolvePrincipalEmails(ids),
    filterByEmailPreference(ids, 'ticket_status_changed'),
  ])
  const recipients = ids.filter((id) => emailMap.has(id) && eligible.has(id))
  if (recipients.length === 0) return []

  const { getStageLabels } = await import('@/lib/server/domains/settings/settings.tickets')
  const stageLabels = await getStageLabels()
  const newLabel = stage ? (stageLabels[stage as keyof typeof stageLabels] ?? stage) : 'Resolved'
  const previousLabel = previousStage
    ? (stageLabels[previousStage as keyof typeof stageLabels] ?? previousStage)
    : null

  const assignedTeamId = ((ticket.assignedTeamId as string | null | undefined) ??
    null) as TeamId | null

  return buildRequesterOrAgentTargets({
    recipients,
    emailMap,
    requesterPrincipalId: emailableRequester as PrincipalId | null,
    kind: 'status_resolved',
    ticketId,
    ticketLabel: formatTicketNumber(ticket.number),
    title,
    assignedTeamId,
    context,
    statusChange: { previousLabel, newLabel },
  })
}

/**
 * `ticket.assigned` → agent emails: the direct assignee (kind `assigned`) and a
 * newly-assigned team's members (kind `assigned_team`), actor-excluded — the
 * same recipient set as the bell (computeTicketAssignmentRecipients), filtered
 * by the `ticket_assigned` matrix key. Inbox CTA, branded From.
 */
export async function getTicketAssignedEmailTargets(
  event: EventData,
  context: HookContext
): Promise<HookTarget[]> {
  if (event.type !== 'ticket.assigned') return []
  if (!(await isSupportTicketsEnabled())) return []
  const { ticket, assignedPrincipalId, previousPrincipalId, assignedTeamId, previousTeamId } =
    event.data

  const { directAssignee, teamMemberIds } = await computeTicketAssignmentRecipients(
    { assignedPrincipalId, previousPrincipalId, assignedTeamId, previousTeamId },
    event.actor.principalId
  )

  const kindById = new Map<PrincipalId, 'assigned' | 'assigned_team'>()
  if (directAssignee) kindById.set(directAssignee, 'assigned')
  for (const id of teamMemberIds) if (!kindById.has(id)) kindById.set(id, 'assigned_team')
  if (kindById.size === 0) return []

  const ids = [...kindById.keys()]
  const [emailMap, eligible] = await Promise.all([
    resolvePrincipalEmails(ids),
    filterByEmailPreference(ids, 'ticket_assigned'),
  ])
  const recipients = ids.filter((id) => emailMap.has(id) && eligible.has(id))
  if (recipients.length === 0) return []

  const ticketId = ticket.id as TicketId
  const ticketLabel = formatTicketNumber(ticket.number)
  const ctaUrl = inboxUrl(context.portalBaseUrl, ticketId)
  // EventTicketRef carries no title (unlike the replied/status payloads), so
  // re-read it for the assignment copy — but only once we know there's a recipient.
  const title = (await readTicketFacts(ticketId))?.title ?? `Ticket ${ticketLabel}`

  return recipients.map((id) =>
    ticketEmailTarget(
      emailMap.get(id)!,
      agentFacingConfig({ kind: kindById.get(id)!, ticketId, ticketLabel, title, ctaUrl, context })
    )
  )
}

/** ISO due-date → a short "Jul 17, 02:00 UTC" label for SLA emails. */
function formatSlaDue(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  })
}

/**
 * `sla.approaching_breach` / `sla.breached` → agent emails. SLA events are
 * conversation-scoped, so this re-reads the conversation for its assigned agent
 * (preferred) else the assigned team's members (getAssistantHandedOffTargets
 * pattern). kinds `sla_warning` / `sla_breach`, matrix keys of the same name,
 * inbox CTA on the conversation. No ticket threading (there is no ticket).
 */
export async function getSlaEmailTargets(
  event: EventData,
  context: HookContext
): Promise<HookTarget[]> {
  if (event.type !== 'sla.approaching_breach' && event.type !== 'sla.breached') return []
  const { conversationId, clock, dueAt } = event.data

  const [conv] = await db
    .select({
      assignedAgentPrincipalId: conversations.assignedAgentPrincipalId,
      assignedTeamId: conversations.assignedTeamId,
      visitorName: principal.displayName,
    })
    .from(conversations)
    .leftJoin(principal, eq(conversations.visitorPrincipalId, principal.id))
    .where(eq(conversations.id, conversationId as ConversationId))
    .limit(1)
  if (!conv) return []

  let recipientIds: PrincipalId[]
  if (conv.assignedAgentPrincipalId) {
    recipientIds = [conv.assignedAgentPrincipalId as PrincipalId]
  } else if (conv.assignedTeamId) {
    const { listTeamMemberPrincipalIds } = await import('@/lib/server/domains/teams')
    recipientIds = await listTeamMemberPrincipalIds(conv.assignedTeamId as TeamId)
  } else {
    return []
  }
  if (recipientIds.length === 0) return []

  // The copy kind and the preference matrix key are the same string.
  const kind =
    event.type === 'sla.approaching_breach' ? ('sla_warning' as const) : ('sla_breach' as const)

  const [emailMap, eligible] = await Promise.all([
    resolvePrincipalEmails(recipientIds),
    filterByEmailPreference(recipientIds, kind),
  ])
  const recipients = recipientIds.filter((id) => emailMap.has(id) && eligible.has(id))
  if (recipients.length === 0) return []

  const title = conv.visitorName ?? 'a customer'
  const clockLabel = clock === 'first_response' ? 'first response' : 'resolution'
  const dueLabel = formatSlaDue(dueAt)
  const ctaUrl = inboxUrl(context.portalBaseUrl, conversationId)

  return recipients.map((id) =>
    ticketEmailTarget(
      emailMap.get(id)!,
      agentFacingConfig({ kind, ticketLabel: '', title, ctaUrl, context, clockLabel, dueLabel })
    )
  )
}

// ============================================================================
// Changelog Subscriber Targets
// ============================================================================

/**
 * Get subscriber targets for changelog.published events: the UNION of the
 * dedicated `changelog_subscriptions` table (primary, opt-out source) and
 * the legacy linked-post subscribers (additive — "subscribers of a feature
 * also hear it shipped"). An explicit changelog unsubscribe always wins over
 * the linked-post source, even for a principal who never had a
 * `changelog_subscriptions` row: {@link unsubscribeChangelog} upserts one.
 */
export async function getChangelogSubscriberTargets(
  event: EventData,
  context: HookContext
): Promise<HookTarget[]> {
  if (event.type !== 'changelog.published') return []

  const changelogId = event.data.changelog.id
  if (!changelogId) return []

  const {
    changelogEntryPosts,
    changelogSubscriptions,
    isNull,
    isNotNull,
    eq: eqOp,
  } = await import('@/lib/server/db')
  const { getChangelogSettings } = await import('@/lib/server/domains/settings/settings.changelog')
  const { resolveSendingAddress } =
    await import('@/lib/server/domains/channel-accounts/channel-account.service')
  const { batchGenerateChangelogUnsubscribeTokens } =
    await import('@/lib/server/domains/subscriptions/subscription.service')

  // 1. Legacy linked-post subscribers (additive source).
  const linkedPosts = await db.query.changelogEntryPosts.findMany({
    where: eqOp(
      changelogEntryPosts.changelogEntryId,
      changelogId as import('@quackback/ids').ChangelogId
    ),
    columns: { postId: true },
  })
  const postIds = linkedPosts.map((lp) => lp.postId)

  const linkedPostSubscribers: Map<string, Subscriber> = new Map()
  for (const postId of postIds) {
    const subs = await getSubscribersForEvent(postId, 'status_change')
    for (const sub of subs) {
      if (!linkedPostSubscribers.has(sub.principalId)) {
        linkedPostSubscribers.set(sub.principalId, sub)
      }
    }
  }

  // 2. Dedicated changelog_subscriptions table (primary source).
  const subscriptionRows = await db
    .select({
      principalId: changelogSubscriptions.principalId,
      userId: principal.userId,
      email: user.email,
      name: user.name,
    })
    .from(changelogSubscriptions)
    .innerJoin(principal, eqOp(changelogSubscriptions.principalId, principal.id))
    .innerJoin(user, eqOp(principal.userId, user.id))
    .where(and(isNull(changelogSubscriptions.unsubscribedAt), isNotNull(user.email)))

  const allSubscribers: Map<string, Subscriber> = new Map()
  for (const row of subscriptionRows) {
    if (!row.email) continue
    allSubscribers.set(row.principalId, {
      principalId: row.principalId,
      userId: row.userId!,
      email: row.email,
      name: row.name,
      reason: 'manual',
      notifyComments: false,
      notifyStatusChanges: true,
    })
  }

  // An explicit changelog unsubscribe (a row with unsubscribedAt set) must
  // exclude a principal from the additive linked-post source too.
  if (linkedPostSubscribers.size > 0) {
    const optOutRows = await db
      .select({ principalId: changelogSubscriptions.principalId })
      .from(changelogSubscriptions)
      .where(isNotNull(changelogSubscriptions.unsubscribedAt))
    const optOutIds = new Set<string>(optOutRows.map((r) => r.principalId))
    for (const [id, sub] of linkedPostSubscribers) {
      if (!allSubscribers.has(id) && !optOutIds.has(id)) {
        allSubscribers.set(id, sub)
      }
    }
  }

  const subscribers = [...allSubscribers.values()]
  log.debug(
    { count: subscribers.length, post_count: postIds.length, changelog_id: changelogId },
    'found unique changelog subscribers (dedicated + linked-post union)'
  )
  if (subscribers.length === 0) return []

  // Filter out the actor
  const nonActorSubscribers = subscribers.filter(
    (subscriber) => !isActorSubscriber(subscriber, event.actor)
  )
  if (nonActorSubscribers.length === 0) return []

  const targets: HookTarget[] = []

  // Build changelog URL
  const changelogUrl = `${context.portalBaseUrl}/changelog`

  // Email targets — gated on the per-principal notification matrix
  // (changelog_published/email, which subsumes emailMuted) and the
  // changelog.emailsDisabled kill switch (in-app notification targets below
  // are unaffected by emailsDisabled — that switch is email-specific).
  const { emailsDisabled } = await getChangelogSettings()
  const eligibleSubscribers = emailsDisabled
    ? []
    : await (async () => {
        const principalIds = nonActorSubscribers.map((s) => s.principalId)
        const prefsMap = await batchGetNotificationPreferences(principalIds)
        return nonActorSubscribers.filter((subscriber) => {
          const prefs = prefsMap.get(subscriber.principalId)
          return prefs ? shouldNotify(prefs, 'changelog_published', 'email') : true
        })
      })()

  if (eligibleSubscribers.length > 0) {
    const from = (await resolveSendingAddress(null, 'changelog')) ?? undefined
    const tokenMap = await batchGenerateChangelogUnsubscribeTokens(
      eligibleSubscribers.map((s) => s.principalId)
    )

    for (const subscriber of eligibleSubscribers) {
      targets.push({
        type: 'email',
        target: {
          email: subscriber.email,
          unsubscribeUrl: `${context.portalBaseUrl}/unsubscribe?token=${tokenMap.get(subscriber.principalId)}`,
        },
        config: {
          workspaceName: context.workspaceName,
          logoUrl: context.logoUrl ?? undefined,
          preferencesUrl: `${context.portalBaseUrl}/settings/preferences`,
          changelogTitle: event.data.changelog.title,
          changelogUrl,
          contentPreview: event.data.changelog.contentPreview,
          eventType: 'changelog.published',
          from,
        },
      })
    }
  }

  // Notification targets
  if (nonActorSubscribers.length > 0) {
    targets.push({
      type: 'notification',
      target: {
        principalIds: nonActorSubscribers.map((s) => s.principalId),
      },
      config: {
        changelogId,
        changelogTitle: event.data.changelog.title,
        changelogUrl,
        contentPreview: event.data.changelog.contentPreview,
        eventType: 'changelog.published',
      },
    })
  }

  return targets
}

// ============================================================================
// Status Page Subscriber Targets
// ============================================================================

const STATUS_COMPONENT_STATUS_LABELS: Record<string, string> = {
  operational: 'Operational',
  degraded_performance: 'Degraded performance',
  partial_outage: 'Partial outage',
  major_outage: 'Major outage',
  under_maintenance: 'Under maintenance',
}

const STATUS_LIFECYCLE_LABELS: Record<string, string> = {
  investigating: 'Investigating',
  identified: 'Identified',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  verifying: 'Verifying',
  completed: 'Completed',
}

/**
 * Subscriber targets for the two status publish events (incident_created,
 * maintenance_scheduled). A subscriber is notified iff (a) they pass the
 * page-level audience gate AND (b) they can see at least one affected
 * component (Status Product Spec §4). Email is additionally gated on the
 * workspace `emailsDisabled` switch and the per-principal notification
 * matrix (`status_incident`/email, which subsumes `emailMuted`); the in-app
 * notification ignores `emailsDisabled` (it's email-specific).
 */
export async function getStatusSubscriberTargets(
  event: EventData,
  context: HookContext
): Promise<HookTarget[]> {
  if (event.type !== 'status.incident_created' && event.type !== 'status.maintenance_scheduled') {
    return []
  }
  const incident = event.data.incident
  const affectedComponentIds = incident.componentIds

  const {
    statusComponents,
    statusIncidentUpdates,
    isNull: isNullOp,
    inArray: inArrayOp,
    eq: eqOp,
    asc: ascOp,
  } = await import('@/lib/server/db')
  const { getActiveSubscribersForComponents } =
    await import('@/lib/server/domains/status/status.subscription')
  const { isStatusAudienceGranted } = await import('@/lib/server/domains/status/status.audience')
  const { canViewStatusComponent } = await import('@/lib/server/policy/status')
  const { getStatusSettings } = await import('@/lib/server/domains/settings/settings.status')
  const { batchGenerateStatusUnsubscribeTokens } =
    await import('@/lib/server/domains/subscriptions/subscription.service')

  const settings = await getStatusSettings()

  // Affected components (for the per-subscriber visibility check + email body).
  const affected = affectedComponentIds.length
    ? await db
        .select({
          id: statusComponents.id,
          name: statusComponents.name,
          segmentIds: statusComponents.segmentIds,
        })
        .from(statusComponents)
        .where(
          and(
            inArrayOp(statusComponents.id, affectedComponentIds as never),
            isNullOp(statusComponents.deletedAt)
          )
        )
    : []
  const affectedById = new Map(affected.map((c) => [String(c.id), c]))

  // The base subscriber pool (page-wide OR overlapping an affected component).
  const principalIds = (await getActiveSubscribersForComponents(
    affectedComponentIds as never
  )) as PrincipalId[]
  if (principalIds.length === 0) return []

  // Batch-load role/type + segments + email for each subscriber.
  const principals = await db
    .select({ id: principal.id, role: principal.role, type: principal.type, email: user.email })
    .from(principal)
    .leftJoin(user, eq(principal.userId, user.id))
    .where(inArray(principal.id, principalIds))

  const segmentRows = await db
    .select({ principalId: userSegments.principalId, segmentId: userSegments.segmentId })
    .from(userSegments)
    .where(inArray(userSegments.principalId, principalIds))
  const segmentsByPrincipal = new Map<string, Set<SegmentId>>()
  for (const row of segmentRows) {
    const key = String(row.principalId)
    const set = segmentsByPrincipal.get(key) ?? new Set<SegmentId>()
    set.add(row.segmentId as SegmentId)
    segmentsByPrincipal.set(key, set)
  }

  // Eligible = passes page gate AND can see ≥1 affected component.
  const eligible = principals.filter((p) => {
    const actor: Actor = {
      principalId: p.id,
      role: (p.role ?? null) as Actor['role'],
      principalType: p.type as Actor['principalType'],
      segmentIds: segmentsByPrincipal.get(String(p.id)) ?? new Set(),
    }
    if (!isStatusAudienceGranted(actor, settings)) return false
    if (affected.length === 0) return true
    return affected.some((c) => canViewStatusComponent(actor, { segmentIds: c.segmentIds }))
  })
  if (eligible.length === 0) return []

  const targets: HookTarget[] = []
  const incidentUrl = `${context.portalBaseUrl}/status/${incident.id}`

  // The publish payload doesn't carry the first update body; fetch the
  // earliest update (the one written at create time) for the email body.
  const [firstUpdate] = await db
    .select({ body: statusIncidentUpdates.body })
    .from(statusIncidentUpdates)
    .where(eqOp(statusIncidentUpdates.incidentId, incident.id as never))
    .orderBy(ascOp(statusIncidentUpdates.createdAt))
    .limit(1)
  const firstUpdateBody = firstUpdate?.body ?? ''

  // Per-viewer affected list is uniform here (all eligible can see ≥1); the
  // email lists every affected component the workspace marked — acceptable,
  // since eligibility already required visibility. Humanize for display.
  const affectedForEmail = affectedComponentIds
    .map((id) => affectedById.get(String(id)))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map((c) => ({
      name: c.name,
      status:
        STATUS_COMPONENT_STATUS_LABELS[incidentStatusForComponent(incident, String(c.id))] ??
        'Operational',
    }))

  // In-app notification target (all eligible; ignores emailsDisabled).
  targets.push({
    type: 'notification',
    target: { principalIds: eligible.map((p) => p.id as PrincipalId) },
    config: {
      eventType: event.type,
      incidentId: incident.id,
      incidentTitle: incident.title,
      incidentUrl,
      kind: incident.kind,
      impact: incident.impact,
      statusLabel: STATUS_LIFECYCLE_LABELS[incident.status] ?? incident.status,
    },
  })

  // Email targets — gated by emailsDisabled + per-principal notification matrix.
  if (!settings.emailsDisabled) {
    const withEmail = eligible.filter((p) => !!p.email)
    if (withEmail.length > 0) {
      const prefsMap = await batchGetNotificationPreferences(
        withEmail.map((p) => p.id as PrincipalId)
      )
      const emailable = withEmail.filter((p) => {
        const prefs = prefsMap.get(p.id as PrincipalId)
        return prefs ? shouldNotify(prefs, 'status_incident', 'email') : true
      })
      if (emailable.length > 0) {
        const tokenMap = await batchGenerateStatusUnsubscribeTokens(
          emailable.map((p) => p.id as PrincipalId)
        )
        for (const p of emailable) {
          targets.push({
            type: 'email',
            target: {
              email: p.email!,
              unsubscribeUrl: `${context.portalBaseUrl}/unsubscribe?token=${tokenMap.get(p.id as PrincipalId)}`,
            },
            config: {
              eventType: event.type,
              workspaceName: context.workspaceName,
              logoUrl: context.logoUrl ?? undefined,
              preferencesUrl: `${context.portalBaseUrl}/settings/preferences`,
              incidentTitle: incident.title,
              incidentUrl,
              impact: incident.impact,
              statusLabel: STATUS_LIFECYCLE_LABELS[incident.status] ?? incident.status,
              body: firstUpdateBody,
              affectedComponents: affectedForEmail,
              scheduledStartLabel: incident.scheduledStartAt
                ? formatStatusDate(incident.scheduledStartAt)
                : null,
              scheduledEndLabel: incident.scheduledEndAt
                ? formatStatusDate(incident.scheduledEndAt)
                : null,
            },
          })
        }
      }
    }
  }

  return targets
}

/** The status a specific component was set to while this incident is open. The
 *  publish payload doesn't carry per-component target statuses, so fall back to
 *  a sensible label; the live page always has the authoritative value. */
function incidentStatusForComponent(
  incident: { impact: string; kind: string },
  _componentId: string
): string {
  if (incident.kind === 'maintenance') return 'under_maintenance'
  switch (incident.impact) {
    case 'critical':
      return 'major_outage'
    case 'major':
      return 'partial_outage'
    case 'minor':
      return 'degraded_performance'
    default:
      return 'degraded_performance'
  }
}

/** ISO string → "July 12, 2026, 02:00 UTC" for maintenance-window emails. */
function formatStatusDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  })
}

// ============================================================================
// Webhook Targets
// ============================================================================

/**
 * Whether a webhook subscription matches an event. The board filter applies
 * only to board-bearing events (post/comment); conversation/message events
 * have no board and match on event-type subscription alone, so a webhook with
 * a board filter still receives the conversation events it subscribed to.
 */
export function webhookSubscriptionMatches(
  webhook: { events: string[]; boardIds: string[] | null },
  event: EventData
): boolean {
  if (!webhook.events.includes(event.type)) return false
  const boardIds = extractBoardIds(event)
  if (webhook.boardIds && webhook.boardIds.length > 0 && boardIds.length > 0) {
    if (!boardIds.some((id) => webhook.boardIds!.includes(id))) return false
  }
  return true
}

// WO-18: webhook target resolution moved to resolvers/webhook.resolver.ts
// (getWebhookTargets deleted here). webhookSubscriptionMatches + extractBoardIds
// stay — they are exported/tested and reused by the webhook resolver's logic.

/**
 * Extract board ID(s) from event data.
 * Returns multiple IDs for merge events (duplicate + canonical may be on different boards).
 */
function extractBoardIds(event: EventData): string[] {
  if ('post' in event.data) {
    return [event.data.post.boardId]
  }
  // post.merged / post.unmerged events have both duplicatePost and canonicalPost
  if (event.type === 'post.merged' || event.type === 'post.unmerged') {
    const data = event.data as PostMergedPayload | PostUnmergedPayload
    const ids = new Set([
      'duplicatePost' in data ? data.duplicatePost.boardId : data.post.boardId,
      'canonicalPost' in data ? data.canonicalPost.boardId : data.formerCanonicalPost.boardId,
    ])
    return [...ids]
  }
  return []
}
