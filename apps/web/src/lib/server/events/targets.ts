/**
 * Hook target resolution.
 * Queries database to determine all targets for an event.
 */

import type { PostId, PrincipalId, UserId, WebhookId } from '@quackback/ids'
import {
  db,
  integrations,
  integrationEventMappings,
  eq,
  and,
  inArray,
  isNull,
  principal,
  webhooks,
} from '@/lib/server/db'
import { decryptSecrets } from '@/lib/server/integrations/encryption'
import { decryptWebhookSecret } from '@/lib/server/domains/webhooks/encryption'
import {
  getSubscribersForEvent,
  batchGetNotificationPreferences,
  batchGenerateUnsubscribeTokens,
  type Subscriber,
  type NotificationEventType,
} from '@/lib/server/domains/subscriptions/subscription.service'
import type { HookTarget } from './hook-types'
import { stripHtml, truncate } from './hook-utils'
import { buildHookContext, type HookContext } from './hook-context'
import type { EventData, EventActor } from './types'
import { isAIEnabled } from '@/lib/server/domains/ai/config'

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
const AI_EVENT_TYPES = ['post.created'] as const
const FEEDBACK_PIPELINE_EVENT_TYPES = ['post.created'] as const
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

    // AI targets (sentiment, embeddings) - only when AI is configured
    if (isAIEnabled() && AI_EVENT_TYPES.includes(event.type as (typeof AI_EVENT_TYPES)[number])) {
      targets.push({
        type: 'ai',
        target: { type: 'ai' },
        config: {},
      })
    }

    // Feedback pipeline target — ingests board posts into aggregation pipeline
    if (
      FEEDBACK_PIPELINE_EVENT_TYPES.includes(
        event.type as (typeof FEEDBACK_PIPELINE_EVENT_TYPES)[number]
      )
    ) {
      targets.push({
        type: 'feedback_pipeline',
        target: {},
        config: {},
      })
    }

    // Summary targets - AI post summary generation
    if (
      isAIEnabled() &&
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

/**
 * Get integration hook targets (Slack, Discord, etc.).
 */
async function getIntegrationTargets(
  event: EventData,
  context: HookContext
): Promise<HookTarget[]> {
  // Never forward private comments to external integrations
  if (event.type === 'comment.created' && event.data.comment.isPrivate) {
    return []
  }

  // Single query: get active, enabled mappings with integration data
  const mappings = await db
    .select({
      integrationType: integrations.integrationType,
      secrets: integrations.secrets,
      integrationConfig: integrations.config,
      actionConfig: integrationEventMappings.actionConfig,
      filters: integrationEventMappings.filters,
    })
    .from(integrationEventMappings)
    .innerJoin(integrations, eq(integrationEventMappings.integrationId, integrations.id))
    .where(
      and(
        eq(integrationEventMappings.eventType, event.type),
        eq(integrationEventMappings.enabled, true),
        eq(integrations.status, 'active')
      )
    )

  if (mappings.length === 0) {
    return []
  }

  const targets: HookTarget[] = []
  const boardId = extractBoardId(event)

  // Track seen (integrationType, channelId) pairs to deduplicate
  const seen = new Set<string>()

  for (const m of mappings) {
    // Apply board filter
    const filters = m.filters as { boardIds?: string[] } | null
    if (filters?.boardIds?.length && boardId && !filters.boardIds.includes(boardId)) {
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
  console.log(
    `[Targets] Found ${subscribers.length} subscribers for ${notifEventType} on post ${postId}`
  )
  if (subscribers.length === 0) return []

  // Filter out the actor (don't notify yourself)
  let nonActorSubscribers = subscribers.filter(
    (subscriber) => !isActorSubscriber(subscriber, event.actor)
  )
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
 * Get webhook hook targets for an event.
 * Queries active webhooks subscribed to this event type and filters by board.
 */
async function getWebhookTargets(event: EventData): Promise<HookTarget[]> {
  // Never deliver private comments to external webhooks
  if (event.type === 'comment.created' && event.data.comment.isPrivate) {
    return []
  }

  try {
    // Get all active, non-deleted webhooks (we filter in JS for simplicity)
    const activeWebhooks = await db.query.webhooks.findMany({
      where: and(eq(webhooks.status, 'active'), isNull(webhooks.deletedAt)),
    })

    if (activeWebhooks.length === 0) {
      return []
    }

    // Extract boardId from event for filtering
    const boardId = extractBoardId(event)

    // Filter webhooks by event type and board
    const matchingWebhooks = activeWebhooks.filter((webhook) => {
      // Must be subscribed to this event type
      if (!webhook.events.includes(event.type)) {
        return false
      }

      // If webhook has board filter, must match
      if (webhook.boardIds && webhook.boardIds.length > 0) {
        if (!boardId || !webhook.boardIds.includes(boardId)) {
          return false
        }
      }

      return true
    })

    console.log(
      `[Targets] Found ${matchingWebhooks.length} webhook(s) for ${event.type}${boardId ? ` (board: ${boardId})` : ''}`
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
 * Extract board ID from event data.
 */
function extractBoardId(event: EventData): string | null {
  // All event types now include boardId in post reference
  if ('post' in event.data) {
    return event.data.post.boardId
  }
  return null
}
