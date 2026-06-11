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
import { decryptWebhookSecret } from '@/lib/server/domains/webhooks/encryption'
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
      console.error('[Targets] Failed to build hook context')
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
    console.error(`[Targets] Failed to resolve targets for ${event.type}:`, error)
    return [] // Graceful degradation - don't crash event processing
  }
}

type CachedIntegrationMapping = {
  integrationId: string
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
    console.log(`[Targets] Integration mappings: cache hit (${cached.length} mappings)`)
    return cached
  }

  const mappings = await db
    .select({
      integrationId: integrations.id,
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

  console.log(`[Targets] Integration mappings: cache miss, fetched ${mappings.length} from DB`)
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
  const inboxIds = extractInboxIds(event)

  // Track seen (integrationType, channelId) pairs to deduplicate
  const seen = new Set<string>()

  for (const m of mappings) {
    // Loop prevention: skip integrations that sourced this event
    if (event.syncSourceIntegrationId && m.integrationId === event.syncSourceIntegrationId) {
      continue
    }

    // Apply board filter — match if any event board overlaps with filter
    const filters = m.filters as { boardIds?: string[]; inboxIds?: string[] } | null
    if (
      filters?.boardIds?.length &&
      boardIds.length > 0 &&
      !boardIds.some((id) => filters.boardIds!.includes(id))
    ) {
      continue
    }

    // Apply inbox filter — match if event inbox overlaps with filter
    if (
      filters?.inboxIds?.length &&
      inboxIds.length > 0 &&
      !inboxIds.some((id) => filters.inboxIds!.includes(id))
    ) {
      continue
    }

    const integrationConfig = (m.integrationConfig as Record<string, unknown>) || {}
    const actionConfig = (m.actionConfig as Record<string, unknown>) || {}
    const channelId = (actionConfig.channelId || integrationConfig.channelId) as string | undefined

    if (!channelId) {
      console.warn(`[Targets] No channelId for ${m.integrationType}, skipping`)
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
        console.error(`[Targets] Failed to decrypt secrets for ${m.integrationType}:`, error)
        continue
      }
    }

    targets.push({
      type: m.integrationType,
      target: { channelId },
      config: { accessToken, rootUrl: context.portalBaseUrl, integrationId: m.integrationId },
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
  console.log(
    `[Targets] Found ${subscribers.length} subscribers for ${notifEventType} on post ${postId}`
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
 * Get subscriber targets for changelog.published events.
 * Looks up all posts linked to the changelog, gets their subscribers,
 * and deduplicates across posts.
 */
async function getChangelogSubscriberTargets(
  event: EventData,
  context: HookContext
): Promise<HookTarget[]> {
  if (event.type !== 'changelog.published') return []

  const changelogId = event.data.changelog.id
  if (!changelogId) return []

  // Look up linked posts
  const { changelogEntryPosts, eq: eqOp } = await import('@/lib/server/db')
  const linkedPosts = await db.query.changelogEntryPosts.findMany({
    where: eqOp(
      changelogEntryPosts.changelogEntryId,
      changelogId as import('@quackback/ids').ChangelogId
    ),
    columns: { postId: true },
  })

  if (linkedPosts.length === 0) return []

  const postIds = linkedPosts.map((lp) => lp.postId)

  // Get subscribers for all linked posts, deduplicated
  const allSubscribers: Map<string, Subscriber> = new Map()
  for (const postId of postIds) {
    const subscribers = await getSubscribersForEvent(postId, 'status_change')
    for (const sub of subscribers) {
      if (!allSubscribers.has(sub.principalId)) {
        allSubscribers.set(sub.principalId, sub)
      }
    }
  }

  const subscribers = [...allSubscribers.values()]
  console.log(
    `[Targets] Found ${subscribers.length} unique subscribers across ${postIds.length} linked posts for changelog ${changelogId}`
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

  // Email targets
  const principalIds = nonActorSubscribers.map((s) => s.principalId)
  const prefsMap = await batchGetNotificationPreferences(principalIds)

  const eligibleSubscribers = nonActorSubscribers.filter((subscriber) => {
    const prefs = prefsMap.get(subscriber.principalId)
    return prefs && shouldSendEmail('post.status_changed', prefs)
  })

  if (eligibleSubscribers.length > 0) {
    // Use the first linked post for unsubscribe tokens
    const firstPostId = postIds[0]
    const tokenMap = await batchGenerateUnsubscribeTokens(
      eligibleSubscribers.map((s) => ({
        principalId: s.principalId,
        postId: firstPostId,
        action: 'unsubscribe_post' as const,
      }))
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
// Webhook Targets
// ============================================================================

/**
 * Whether a webhook subscription matches an event. The board filter applies
 * only to board-bearing events (post/comment); conversation/message events
 * have no board and match on event-type subscription alone, so a webhook with
 * a board filter still receives the chat events it subscribed to.
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

  // Never deliver internal ticket notes to external webhooks — they are
  // private agent-only context (analogous to private comments).
  if (
    event.type === 'ticket.thread_added' &&
    (event.data as { audience?: string }).audience === 'internal'
  ) {
    return []
  }

  try {
    // Get all active, non-deleted webhooks from cache or DB (filter in JS)
    let activeWebhooks = await cacheGet<(typeof webhooks.$inferSelect)[]>(
      CACHE_KEYS.ACTIVE_WEBHOOKS
    )
    if (activeWebhooks) {
      console.log(`[Targets] Active webhooks: cache hit (${activeWebhooks.length} webhooks)`)
    } else {
      activeWebhooks = await db.query.webhooks.findMany({
        where: and(eq(webhooks.status, 'active'), isNull(webhooks.deletedAt)),
      })
      console.log(`[Targets] Active webhooks: cache miss, fetched ${activeWebhooks.length} from DB`)
      await cacheSet(CACHE_KEYS.ACTIVE_WEBHOOKS, activeWebhooks, 300)
    }

    if (activeWebhooks.length === 0) {
      return []
    }

    // Extract boardId(s) from event for filtering
    const boardIds = extractBoardIds(event)
    // Extract inboxId(s) from event for filtering (Phase 4 — ticket events)
    const inboxIds = extractInboxIds(event)

    // Filter webhooks by event type and board
    const matchingWebhooks = activeWebhooks.filter((webhook) => {
      // Must be subscribed to this event type
      if (!webhook.events.includes(event.type)) {
        return false
      }

      // If webhook has board filter, must match at least one event board
      if (webhook.boardIds && webhook.boardIds.length > 0) {
        if (boardIds.length === 0 || !boardIds.some((id) => webhook.boardIds!.includes(id))) {
          return false
        }
      }

      // If webhook has inbox filter, must match at least one event inbox.
      // Scope: only applies to ticket.* events. Non-ticket subscriptions
      // (e.g. post.created) on the same webhook are NOT constrained.
      // Opt-in semantics for tickets: an event with no inboxId is excluded
      // by an inbox-filtered webhook (better to drop than over-deliver).
      if (webhook.inboxIds && webhook.inboxIds.length > 0 && event.type.startsWith('ticket.')) {
        if (inboxIds.length === 0 || !inboxIds.some((id) => webhook.inboxIds!.includes(id))) {
          return false
        }
      }

      return true
    })

    console.log(
      `[Targets] Found ${matchingWebhooks.length} webhook(s) for ${event.type}${boardIds.length ? ` (boards: ${boardIds.join(', ')})` : ''}${inboxIds.length ? ` (inboxes: ${inboxIds.join(', ')})` : ''}`
    )

    // Build targets - decrypt secrets for delivery
    const targets: HookTarget[] = []
    for (const webhook of matchingWebhooks) {
      try {
        const secret = decryptWebhookSecret(webhook.secret)
        targets.push({
          type: 'webhook',
          target: { url: webhook.url },
          config: { secret, webhookId: webhook.id as WebhookId },
        })
      } catch (error) {
        console.error(`[Targets] Failed to decrypt webhook secret for ${webhook.id}:`, error)
        // Skip this webhook rather than crash all
      }
    }
    return targets
  } catch (error) {
    console.error('[Targets] Failed to resolve webhook targets:', error)
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

/**
 * Extract inbox ID(s) from event data (Phase 4 — ticket events).
 * Returns the ticket's `inboxId` for any event whose payload embeds an
 * `EventTicketRef`. Configuration-plane events (inbox/team/status CRUD) and
 * non-ticket events return an empty array — webhooks with an `inboxIds`
 * filter will simply not constrain those event types.
 */
function extractInboxIds(event: EventData): string[] {
  const data = event.data as { ticket?: { inboxId?: string | null } }
  const inboxId = data.ticket?.inboxId
  return inboxId ? [inboxId] : []
}
