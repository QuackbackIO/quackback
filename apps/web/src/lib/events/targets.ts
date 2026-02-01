/**
 * Hook target resolution.
 * Queries database to determine all targets for an event.
 */

import type { PostId, UserId, WebhookId } from '@quackback/ids'
import {
  db,
  integrations,
  integrationEventMappings,
  decryptToken,
  eq,
  and,
  member,
  webhooks,
} from '@/lib/db'
import {
  getSubscribersForEvent,
  batchGetNotificationPreferences,
  batchGenerateUnsubscribeTokens,
  type Subscriber,
  type NotificationEventType,
} from '@/lib/subscriptions/subscription.service'
import type { HookTarget } from './hook-types'
import { stripHtml, truncate } from './hook-utils'
import { buildHookContext, type HookContext } from './hook-context'
import type { EventData, EventActor } from './types'

/**
 * Map system event types to notification event types
 */
function getNotificationEventType(eventType: string): NotificationEventType | null {
  switch (eventType) {
    case 'post.status_changed':
      return 'status_change'
    case 'comment.created':
      return 'comment'
    default:
      return null
  }
}

const EMAIL_EVENT_TYPES = ['post.status_changed', 'comment.created'] as const
const NOTIFICATION_EVENT_TYPES = ['post.status_changed', 'comment.created'] as const
const AI_EVENT_TYPES = ['post.created'] as const
const WEBHOOK_EVENT_TYPES = ['post.created', 'post.status_changed', 'comment.created'] as const

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

    // Email targets (subscribers)
    if (EMAIL_EVENT_TYPES.includes(event.type as (typeof EMAIL_EVENT_TYPES)[number])) {
      const emailTargets = await getEmailTargets(event, context)
      targets.push(...emailTargets)
    }

    // In-app notification targets (subscribers)
    if (
      NOTIFICATION_EVENT_TYPES.includes(event.type as (typeof NOTIFICATION_EVENT_TYPES)[number])
    ) {
      const notificationTargets = await getNotificationTargets(event, context)
      targets.push(...notificationTargets)
    }

    // AI targets (sentiment, embeddings) - always run for post.created
    if (AI_EVENT_TYPES.includes(event.type as (typeof AI_EVENT_TYPES)[number])) {
      targets.push({
        type: 'ai',
        target: { type: 'ai' },
        config: {},
      })
    }

    // Webhook targets - external HTTP endpoints
    if (WEBHOOK_EVENT_TYPES.includes(event.type as (typeof WEBHOOK_EVENT_TYPES)[number])) {
      const webhookTargets = await getWebhookTargets(event)
      targets.push(...webhookTargets)
    }

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
  // Single query: get active, enabled mappings with integration data
  const mappings = await db
    .select({
      integrationType: integrations.integrationType,
      accessTokenEncrypted: integrations.accessTokenEncrypted,
      integrationConfig: integrations.config,
      actionConfig: integrationEventMappings.actionConfig,
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

  for (const m of mappings) {
    const integrationConfig = (m.integrationConfig as Record<string, unknown>) || {}
    const actionConfig = (m.actionConfig as Record<string, unknown>) || {}
    const channelId = (actionConfig.channelId || integrationConfig.channelId) as string | undefined

    if (!channelId) {
      console.warn(`[Targets] No channelId for ${m.integrationType}, skipping`)
      continue
    }

    let accessToken: string | undefined
    if (m.accessTokenEncrypted) {
      try {
        accessToken = decryptToken(m.accessTokenEncrypted, context.workspaceId)
      } catch (error) {
        console.error(`[Targets] Failed to decrypt token for ${m.integrationType}:`, error)
        continue // Skip this integration rather than crash all
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
 * Get email hook targets (subscribers).
 * Filters by:
 * 1. Subscription level (notifyComments/notifyStatusChanges based on event type)
 * 2. Global email preferences (emailNewComment/emailStatusChange)
 * 3. Not the actor (don't notify yourself)
 */
async function getEmailTargets(event: EventData, context: HookContext): Promise<HookTarget[]> {
  const postId = extractPostId(event)
  if (!postId) return []

  // Map event type to notification event type
  const notifEventType = getNotificationEventType(event.type)
  if (!notifEventType) return []

  // Get subscribers who want this type of notification (subscription level filter)
  const subscribers = await getSubscribersForEvent(postId, notifEventType)
  console.log(
    `[Targets] Found ${subscribers.length} subscribers for ${notifEventType} on post ${postId}`
  )

  if (subscribers.length === 0) return []

  // Build event-specific config
  const eventConfig = await buildEmailEventConfig(event, context.portalBaseUrl)
  if (!eventConfig) return []

  // Batch get notification preferences (single query instead of N queries)
  const memberIds = subscribers.map((s) => s.memberId)
  const prefsMap = await batchGetNotificationPreferences(memberIds)

  // Filter to eligible subscribers (not actor, email preferences allow)
  const eligibleSubscribers = subscribers.filter((subscriber) => {
    // Skip the actor (don't notify yourself)
    if (isActorSubscriber(subscriber, event.actor)) {
      return false
    }
    // Check global email preferences
    const prefs = prefsMap.get(subscriber.memberId)
    return prefs && shouldSendEmail(event.type, prefs)
  })

  if (eligibleSubscribers.length === 0) return []

  // Batch generate unsubscribe tokens (single insert instead of N inserts)
  const tokenMap = await batchGenerateUnsubscribeTokens(
    eligibleSubscribers.map((s) => ({
      memberId: s.memberId,
      postId,
      action: 'unsubscribe_post' as const,
    }))
  )

  // Build targets
  return eligibleSubscribers.map((subscriber) => ({
    type: 'email',
    target: {
      email: subscriber.email,
      unsubscribeUrl: `${context.portalBaseUrl}/unsubscribe?token=${tokenMap.get(subscriber.memberId)}`,
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
  if (actor.type === 'system') return false
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
 * Check if actor is a team member (cached per event).
 */
async function isActorTeamMember(actor: EventActor): Promise<boolean> {
  if (!actor.userId) return false
  const commenterMember = await db.query.member.findFirst({
    where: eq(member.userId, actor.userId as UserId),
    columns: { role: true },
  })
  return commenterMember?.role !== 'user'
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
      postUrl: `${rootUrl}/b/${post.boardSlug}/posts/${post.id}`,
      previousStatus,
      newStatus,
    }
  }

  if (event.type === 'comment.created') {
    const { comment, post } = event.data
    return {
      postTitle: post.title,
      postUrl: `${rootUrl}/b/${post.boardSlug}/posts/${post.id}#comment-${comment.id}`,
      commenterName: comment.authorEmail?.split('@')[0] ?? 'Someone',
      commentPreview: truncate(stripHtml(comment.content), 200),
      isTeamMember: await isActorTeamMember(event.actor),
    }
  }

  return null
}

/**
 * Get in-app notification targets (subscribers).
 * Filters by subscription level (notifyComments/notifyStatusChanges based on event type).
 * Returns a single target with all member IDs for batch insertion.
 */
async function getNotificationTargets(
  event: EventData,
  context: HookContext
): Promise<HookTarget[]> {
  const postId = extractPostId(event)
  if (!postId) return []

  // Map event type to notification event type
  const notifEventType = getNotificationEventType(event.type)
  if (!notifEventType) return []

  // Get subscribers who want this type of notification (subscription level filter)
  const subscribers = await getSubscribersForEvent(postId, notifEventType)

  if (subscribers.length === 0) return []

  // Filter out the actor (don't notify yourself)
  const eligibleSubscribers = subscribers.filter(
    (subscriber) => !isActorSubscriber(subscriber, event.actor)
  )

  if (eligibleSubscribers.length === 0) return []

  // Build notification config based on event type
  const config = await buildNotificationConfig(event, context.portalBaseUrl)
  if (!config) return []

  // Return single target with all member IDs (for batch insert)
  return [
    {
      type: 'notification',
      target: {
        memberIds: eligibleSubscribers.map((s) => s.memberId),
      },
      config,
    },
  ]
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
      postUrl: `${rootUrl}/b/${post.boardSlug}/posts/${post.id}`,
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
      postUrl: `${rootUrl}/b/${post.boardSlug}/posts/${post.id}#comment-${comment.id}`,
      commentId: comment.id,
      commenterName: comment.authorEmail?.split('@')[0] ?? 'Someone',
      commentPreview: truncate(stripHtml(comment.content), 200),
      isTeamMember: await isActorTeamMember(event.actor),
    }
  }

  return null
}

// ============================================================================
// Webhook Targets
// ============================================================================

/**
 * Get webhook hook targets for an event.
 * Queries active webhooks subscribed to this event type and filters by board.
 */
async function getWebhookTargets(event: EventData): Promise<HookTarget[]> {
  try {
    // Get all active webhooks (we filter in JS for simplicity)
    const activeWebhooks = await db.query.webhooks.findMany({
      where: eq(webhooks.status, 'active'),
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
        const secret = decryptToken(webhook.secret, webhook.id)
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
