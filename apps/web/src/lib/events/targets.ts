/**
 * Hook target resolution.
 * Queries database to determine all targets for an event.
 */

import type { PostId, UserId } from '@quackback/ids'
import { db, integrations, integrationEventMappings, decryptToken, eq, and, member } from '@/lib/db'
import {
  getActiveSubscribers,
  batchGetNotificationPreferences,
  batchGenerateUnsubscribeTokens,
  type Subscriber,
} from '@/lib/subscriptions/subscription.service'
import type { HookTarget } from '@/lib/hooks/types'
import { stripHtml, truncate, getRootUrl } from '@/lib/hooks/utils'
import type { EventData, EventActor } from './types'

const EMAIL_EVENT_TYPES = ['post.status_changed', 'comment.created'] as const

/**
 * Get all hook targets for an event.
 * Gracefully handles errors - returns empty array on failure.
 */
export async function getHookTargets(event: EventData): Promise<HookTarget[]> {
  try {
    const targets: HookTarget[] = []

    // Integration targets (Slack, Discord, etc.)
    const integrationTargets = await getIntegrationTargets(event)
    targets.push(...integrationTargets)

    // Email targets (subscribers)
    if (EMAIL_EVENT_TYPES.includes(event.type as (typeof EMAIL_EVENT_TYPES)[number])) {
      const emailTargets = await getEmailTargets(event)
      targets.push(...emailTargets)
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
async function getIntegrationTargets(event: EventData): Promise<HookTarget[]> {
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

  // Get workspace ID for token decryption
  const settings = await db.query.settings.findFirst({ columns: { id: true } })
  if (!settings) {
    console.error('[Targets] Settings not found')
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
        accessToken = decryptToken(m.accessTokenEncrypted, settings.id)
      } catch (error) {
        console.error(`[Targets] Failed to decrypt token for ${m.integrationType}:`, error)
        continue // Skip this integration rather than crash all
      }
    }

    targets.push({
      type: m.integrationType,
      target: { channelId },
      config: { accessToken },
    })
  }

  return targets
}

/**
 * Get email hook targets (subscribers).
 */
async function getEmailTargets(event: EventData): Promise<HookTarget[]> {
  const postId = extractPostId(event)
  if (!postId) return []

  // Get workspace info
  const settings = await db.query.settings.findFirst({ columns: { name: true } })
  if (!settings) {
    console.error('[Targets] Settings not found')
    return []
  }

  const rootUrl = getRootUrl()
  const subscribers = await getActiveSubscribers(postId)
  console.log(`[Targets] Found ${subscribers.length} subscribers for post ${postId}`)

  if (subscribers.length === 0) return []

  // Build event-specific config
  const eventConfig = await buildEmailEventConfig(event, rootUrl)
  if (!eventConfig) return []

  // Batch get notification preferences (single query instead of N queries)
  const memberIds = subscribers.map((s) => s.memberId)
  const prefsMap = await batchGetNotificationPreferences(memberIds)

  // Filter to eligible subscribers (not actor, preferences allow)
  const eligibleSubscribers = subscribers.filter((subscriber) => {
    // Skip the actor (don't notify yourself)
    if (isActorSubscriber(subscriber, event.actor)) {
      return false
    }
    // Check preferences
    const prefs = prefsMap.get(subscriber.memberId)
    return prefs && shouldNotifySubscriber(event.type, prefs)
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
      unsubscribeUrl: `${rootUrl}/unsubscribe?token=${tokenMap.get(subscriber.memberId)}`,
    },
    config: {
      workspaceName: settings.name,
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

const EVENT_PREF_MAP: Record<string, 'emailStatusChange' | 'emailNewComment'> = {
  'post.status_changed': 'emailStatusChange',
  'comment.created': 'emailNewComment',
}

/**
 * Check if subscriber should be notified based on preferences.
 */
function shouldNotifySubscriber(
  eventType: string,
  prefs: { emailStatusChange: boolean; emailNewComment: boolean; emailMuted: boolean }
): boolean {
  if (prefs.emailMuted) return false
  const prefKey = EVENT_PREF_MAP[eventType]
  return prefKey ? prefs[prefKey] : false
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

    // Check if commenter is a team member
    const commenterMember = event.actor.userId
      ? await db.query.member.findFirst({
          where: eq(member.userId, event.actor.userId as UserId),
          columns: { role: true },
        })
      : null
    const isTeamMember = commenterMember?.role !== 'user'

    return {
      postTitle: post.title,
      postUrl: `${rootUrl}/b/${post.boardSlug}/posts/${post.id}`,
      commenterName: comment.authorEmail?.split('@')[0] ?? 'Someone',
      commentPreview: truncate(stripHtml(comment.content), 200),
      isTeamMember,
    }
  }

  return null
}
