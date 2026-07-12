/**
 * Hook target resolution.
 * Queries database to determine all targets for an event.
 */

import type { PostId, PrincipalId, SegmentId, UserId, WebhookId } from '@quackback/ids'
import {
  db,
  integrations,
  integrationEventMappings,
  eq,
  and,
  inArray,
  isNull,
  principal,
  user,
  webhooks,
  posts,
  boards,
  userSegments,
} from '@/lib/server/db'
import { canViewPost, type Actor } from '@/lib/server/policy'
import { decryptSecrets } from '@/lib/server/integrations/encryption'
import {
  getSubscribersForEvent,
  batchGetNotificationPreferences,
  batchGenerateUnsubscribeTokens,
  type Subscriber,
  type NotificationEventType,
} from '@/lib/server/domains/subscriptions/subscription.service'
import { cacheGet, cacheSet, CACHE_KEYS } from '@/lib/server/redis'
import type { HookTarget } from './hook-types'
import { stripHtml, truncate } from './hook-utils'
import { buildHookContext, type HookContext } from './hook-context'
import type { EventData, EventActor, PostMergedPayload, PostUnmergedPayload } from './types'
import { getOpenAI } from '@/lib/server/domains/ai/config'
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
const SUBSCRIBER_EVENT_TYPES = [
  'post.status_changed',
  'comment.created',
  'changelog.published',
] as const
/** Events that resolve a single mentioned principal as the notification target */
const MENTION_EVENT_TYPES = ['post.mentioned'] as const
const AI_EVENT_TYPES = ['post.created'] as const
const SUMMARY_EVENT_TYPES = ['post.created', 'comment.created'] as const
/**
 * Get all hook targets for an event.
 * Gracefully handles errors - returns empty array on failure.
 */
export async function getHookTargets(event: EventData): Promise<HookTarget[]> {
  try {
    // Build context ONCE at the start - consolidates all settings/URL queries
    const context = await buildHookContext()
    if (!context) {
      log.error('failed to build hook context')
      return []
    }

    const targets: HookTarget[] = []

    // Integration targets (Slack, Discord, etc.)
    const integrationTargets = await getIntegrationTargets(event, context)
    targets.push(...integrationTargets)

    // Email and in-app notification targets (subscribers)
    if (SUBSCRIBER_EVENT_TYPES.includes(event.type as (typeof SUBSCRIBER_EVENT_TYPES)[number])) {
      if (event.type === 'changelog.published') {
        const changelogTargets = await getChangelogSubscriberTargets(event, context)
        targets.push(...changelogTargets)
      } else {
        const subscriberTargets = await getSubscriberTargets(event, context)
        targets.push(...subscriberTargets)
      }
    }

    // Status page publish events — email fires only here (Status Product Spec §9).
    if (event.type === 'status.incident_created' || event.type === 'status.maintenance_scheduled') {
      const statusTargets = await getStatusSubscriberTargets(event, context)
      targets.push(...statusTargets)
    }

    // Direct-mention targets (single principal whose id is in the payload)
    if (MENTION_EVENT_TYPES.includes(event.type as (typeof MENTION_EVENT_TYPES)[number])) {
      const mentionTargets = await getMentionTargets(event, context)
      targets.push(...mentionTargets)
    }

    // AI targets (sentiment, embeddings) - only when AI is configured
    if (getOpenAI() && AI_EVENT_TYPES.includes(event.type as (typeof AI_EVENT_TYPES)[number])) {
      targets.push({
        type: 'ai',
        target: { type: 'ai' },
        config: {},
      })
    }

    // Summary targets - AI post summary generation
    if (
      getOpenAI() &&
      SUMMARY_EVENT_TYPES.includes(event.type as (typeof SUMMARY_EVENT_TYPES)[number])
    ) {
      targets.push({
        type: 'summary',
        target: { type: 'summary' },
        config: {},
      })
    }

    // Webhook targets - external HTTP endpoints (all event types)
    const webhookTargets = await getWebhookTargets(event)
    targets.push(...webhookTargets)

    return targets
  } catch (error) {
    log.error({ err: error, event_type: event.type }, 'failed to resolve targets')
    return [] // Graceful degradation - don't crash event processing
  }
}

type CachedIntegrationMapping = {
  eventType: string
  integrationType: string
  secrets: string | null
  integrationConfig: unknown
  actionConfig: unknown
  filters: unknown
}

async function getCachedIntegrationMappings(): Promise<CachedIntegrationMapping[]> {
  const cached = await cacheGet<CachedIntegrationMapping[]>(CACHE_KEYS.INTEGRATION_MAPPINGS)
  if (cached) {
    log.debug({ count: cached.length }, 'integration mappings cache hit')
    return cached
  }

  const mappings = await db
    .select({
      eventType: integrationEventMappings.eventType,
      integrationType: integrations.integrationType,
      secrets: integrations.secrets,
      integrationConfig: integrations.config,
      actionConfig: integrationEventMappings.actionConfig,
      filters: integrationEventMappings.filters,
    })
    .from(integrationEventMappings)
    .innerJoin(integrations, eq(integrationEventMappings.integrationId, integrations.id))
    .where(and(eq(integrationEventMappings.enabled, true), eq(integrations.status, 'active')))

  log.debug({ count: mappings.length }, 'integration mappings cache miss')
  await cacheSet(CACHE_KEYS.INTEGRATION_MAPPINGS, mappings, 300)
  return mappings
}

/**
 * Get integration hook targets (Slack, Discord, etc.).
 */
async function getIntegrationTargets(
  event: EventData,
  context: HookContext
): Promise<HookTarget[]> {
  // Never forward private comments to external integrations
  if (
    (event.type === 'comment.created' ||
      event.type === 'comment.updated' ||
      event.type === 'comment.deleted') &&
    event.data.comment.isPrivate
  ) {
    return []
  }

  // Get all active mappings from cache or DB, then filter by event type
  const allMappings = await getCachedIntegrationMappings()
  const mappings = allMappings.filter((m) => m.eventType === event.type)

  if (mappings.length === 0) {
    return []
  }

  const targets: HookTarget[] = []
  const boardIds = extractBoardIds(event)

  // Track seen (integrationType, channelId) pairs to deduplicate
  const seen = new Set<string>()

  for (const m of mappings) {
    // Apply board filter — match if any event board overlaps with filter
    const filters = m.filters as { boardIds?: string[] } | null
    if (
      filters?.boardIds?.length &&
      boardIds.length > 0 &&
      !boardIds.some((id) => filters.boardIds!.includes(id))
    ) {
      continue
    }

    const integrationConfig = (m.integrationConfig as Record<string, unknown>) || {}
    const actionConfig = (m.actionConfig as Record<string, unknown>) || {}
    const channelId = (actionConfig.channelId || integrationConfig.channelId) as string | undefined

    if (!channelId) {
      log.warn({ integration_type: m.integrationType }, 'no channel id for integration, skipping')
      continue
    }

    // Deduplicate by (integrationType, channelId)
    const dedupeKey = `${m.integrationType}:${channelId}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    let accessToken: string | undefined
    if (m.secrets) {
      try {
        const secrets = decryptSecrets<{ accessToken?: string }>(m.secrets)
        accessToken = secrets.accessToken
      } catch (error) {
        log.error(
          { err: error, integration_type: m.integrationType },
          'failed to decrypt integration secrets'
        )
        continue
      }
    }

    targets.push({
      type: m.integrationType,
      target: { channelId },
      config: { accessToken, rootUrl: context.portalBaseUrl },
    })
  }

  return targets
}

/**
 * Get email and in-app notification targets for subscribers.
 * Fetches subscribers once, then builds both email and notification targets.
 */
async function getSubscriberTargets(event: EventData, context: HookContext): Promise<HookTarget[]> {
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

  // Filter by global email preferences
  const eligibleSubscribers = subscribers.filter((subscriber) => {
    const prefs = prefsMap.get(subscriber.principalId)
    return prefs && shouldSendEmail(event.type, prefs)
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
  return subscriber.userId === actor.userId || subscriber.email === actor.email
}

const EVENT_EMAIL_PREF_MAP: Record<string, 'emailStatusChange' | 'emailNewComment'> = {
  'post.status_changed': 'emailStatusChange',
  'comment.created': 'emailNewComment',
}

/**
 * Check if email should be sent based on global email preferences.
 * Note: Subscription level (notifyComments/notifyStatusChanges) is already filtered
 * by getSubscribersForEvent. This checks the global email preferences.
 */
function shouldSendEmail(
  eventType: string,
  prefs: { emailStatusChange: boolean; emailNewComment: boolean; emailMuted: boolean }
): boolean {
  if (prefs.emailMuted) return false
  const prefKey = EVENT_EMAIL_PREF_MAP[eventType]
  return prefKey ? prefs[prefKey] : false
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
async function getMentionTargets(event: EventData, context: HookContext): Promise<HookTarget[]> {
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
    // Honour the global emailMuted preference. Without this, a user who hit
    // unsubscribe-all (which sets emailMuted=true) would still get direct
    // mention emails because the mention path doesn't go through the
    // subscriber filter that runs shouldSendEmail.
    const prefsMap = await batchGetNotificationPreferences([row.id as PrincipalId])
    const prefs = prefsMap.get(row.id as PrincipalId)
    if (!prefs?.emailMuted) {
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
          eventType: 'post.mentioned',
        },
      })
    }
  }

  return targets
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
async function getChangelogSubscriberTargets(
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

  // Email targets — gated on the workspace's emailMuted preference and the
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
          return prefs ? !prefs.emailMuted : true
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
 * workspace `emailsDisabled` switch and the per-principal `emailMuted` pref;
 * the in-app notification ignores `emailsDisabled` (it's email-specific).
 */
async function getStatusSubscriberTargets(
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

  // Email targets — gated by emailsDisabled + per-principal emailMuted.
  if (!settings.emailsDisabled) {
    const withEmail = eligible.filter((p) => !!p.email)
    if (withEmail.length > 0) {
      const prefsMap = await batchGetNotificationPreferences(
        withEmail.map((p) => p.id as PrincipalId)
      )
      const emailable = withEmail.filter((p) => {
        const prefs = prefsMap.get(p.id as PrincipalId)
        return prefs ? !prefs.emailMuted : true
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

/**
 * Get webhook hook targets for an event.
 * Queries active webhooks subscribed to this event type and filters by board.
 */
async function getWebhookTargets(event: EventData): Promise<HookTarget[]> {
  // Never deliver private comments to external webhooks
  if (
    (event.type === 'comment.created' ||
      event.type === 'comment.updated' ||
      event.type === 'comment.deleted') &&
    event.data.comment.isPrivate
  ) {
    return []
  }

  try {
    // Get all active, non-deleted webhooks from cache or DB (filter in JS)
    let activeWebhooks = await cacheGet<(typeof webhooks.$inferSelect)[]>(
      CACHE_KEYS.ACTIVE_WEBHOOKS
    )
    if (activeWebhooks) {
      log.debug({ count: activeWebhooks.length }, 'active webhooks cache hit')
    } else {
      activeWebhooks = await db.query.webhooks.findMany({
        where: and(eq(webhooks.status, 'active'), isNull(webhooks.deletedAt)),
      })
      log.debug({ count: activeWebhooks.length }, 'active webhooks cache miss')
      await cacheSet(CACHE_KEYS.ACTIVE_WEBHOOKS, activeWebhooks, 300)
    }

    if (activeWebhooks.length === 0) {
      return []
    }

    // Extract boardId(s) from event for filtering
    const boardIds = extractBoardIds(event)

    // Filter by event-type subscription and (board-bearing events only) board.
    const matchingWebhooks = activeWebhooks.filter((webhook) =>
      webhookSubscriptionMatches(webhook, event)
    )

    log.debug(
      { count: matchingWebhooks.length, event_type: event.type, board_ids: boardIds },
      'found matching webhooks for event'
    )

    // Build targets. The signing secret is deliberately left out of the
    // config — it would otherwise sit in plaintext inside the BullMQ job
    // payload (Redis) for the life of the job. The delivery handler loads
    // and decrypts it itself, right before signing, using the webhookId.
    const targets: HookTarget[] = matchingWebhooks.map((webhook) => ({
      type: 'webhook',
      target: { url: webhook.url },
      config: { webhookId: webhook.id as WebhookId },
    }))
    return targets
  } catch (error) {
    log.error({ err: error }, 'failed to resolve webhook targets')
    return []
  }
}

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
