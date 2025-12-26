/**
 * Shared user notification processing logic.
 *
 * This module contains the business logic for sending email notifications,
 * extracted to be used by both BullMQ workers and Cloudflare Workflows.
 */

import { db, eq, member, posts } from '@quackback/db'
import type {
  UserNotificationJobData,
  UserNotificationJobResult,
  PostStatusChangedPayload,
  CommentCreatedPayload,
} from '../types'
import { sendStatusChangeEmail, sendNewCommentEmail } from '@quackback/email'
import { SubscriptionService, type Subscriber } from '@quackback/domain/subscriptions'
import type { PostId, UserId } from '@quackback/ids'

/**
 * Options for processing user notifications.
 */
export interface ProcessUserNotificationOptions {
  /** App domain for URL generation fallback (required in Cloudflare Workers) */
  appDomain?: string
}

/**
 * Process a user notification job.
 * Looks up subscribers for the affected post and sends appropriate emails.
 */
export async function processUserNotification(
  data: UserNotificationJobData,
  options: ProcessUserNotificationOptions = {}
): Promise<UserNotificationJobResult> {
  const { eventId, eventType, actor, data: eventData } = data
  const _options = options

  console.log(`[UserNotifications] Processing ${eventType} event ${eventId}`)

  const subscriptionService = new SubscriptionService()
  const errors: string[] = []
  let emailsSent = 0
  let skipped = 0

  try {
    // Get organization details for email content (single-tenant: just get the first settings row)
    const org = await db.query.settings.findFirst({
      columns: { name: true },
    })

    if (!org) {
      console.error(`[UserNotifications] Settings not found - workspace not initialized`)
      return { emailsSent: 0, skipped: 0, errors: ['Settings not found'] }
    }

    // Get root URL for email links
    const rootUrl = getRootUrl()

    // Process based on event type
    switch (eventType) {
      case 'post.status_changed': {
        const statusData = eventData as PostStatusChangedPayload
        const postId = statusData.post.id as PostId

        // Get active subscribers for this post
        const subscribers = await subscriptionService.getActiveSubscribers(postId)
        console.log(
          `[UserNotifications] Found ${subscribers.length} subscribers for post ${postId}`
        )

        for (const subscriber of subscribers) {
          // Skip the actor (don't notify about own actions)
          if (shouldSkipActor(subscriber, actor)) {
            console.log(`[UserNotifications] Skipping actor ${subscriber.email}`)
            skipped++
            continue
          }

          // Check notification preferences
          const prefs = await subscriptionService.getNotificationPreferences(subscriber.memberId)
          if (!prefs.emailStatusChange || prefs.emailMuted) {
            console.log(`[UserNotifications] Preferences disabled for ${subscriber.email}`)
            skipped++
            continue
          }

          // Generate unsubscribe token
          const unsubscribeToken = await subscriptionService.generateUnsubscribeToken(
            subscriber.memberId,
            postId,
            'unsubscribe_post'
          )

          // Build URLs
          const postUrl = `${rootUrl}/b/${statusData.post.boardSlug}/posts/${postId}`
          const unsubscribeUrl = `${rootUrl}/unsubscribe?token=${unsubscribeToken}`

          try {
            await sendStatusChangeEmail({
              to: subscriber.email,
              postTitle: statusData.post.title,
              postUrl,
              previousStatus: statusData.previousStatus,
              newStatus: statusData.newStatus,
              workspaceName: org.name,
              unsubscribeUrl,
            })
            emailsSent++
            console.log(`[UserNotifications] Sent status change email to ${subscriber.email}`)
          } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error'
            errors.push(`Failed to email ${subscriber.email}: ${msg}`)
            console.error(`[UserNotifications] Failed to email ${subscriber.email}:`, error)
          }
        }
        break
      }

      case 'comment.created': {
        const commentData = eventData as CommentCreatedPayload
        const postId = commentData.post.id as PostId

        // Get active subscribers for this post
        const subscribers = await subscriptionService.getActiveSubscribers(postId)
        console.log(
          `[UserNotifications] Found ${subscribers.length} subscribers for post ${postId}`
        )

        // Get commenter info for the email
        const commenterName = commentData.comment.authorEmail?.split('@')[0] || 'Someone'
        const commentPreview = truncateText(stripHtml(commentData.comment.content), 200)

        // Check if commenter is a team member
        const commenterMember = actor.userId
          ? await db.query.member.findFirst({
              where: eq(member.userId, actor.userId as UserId),
              columns: { role: true },
            })
          : null
        const isTeamMember = commenterMember?.role !== 'user'

        // Get board slug for URL
        const boardSlug = await getPostBoardSlug(postId)

        for (const subscriber of subscribers) {
          // Skip the actor (don't notify about own comments)
          if (shouldSkipActor(subscriber, actor)) {
            console.log(`[UserNotifications] Skipping actor ${subscriber.email}`)
            skipped++
            continue
          }

          // Check notification preferences
          const prefs = await subscriptionService.getNotificationPreferences(subscriber.memberId)
          if (!prefs.emailNewComment || prefs.emailMuted) {
            console.log(`[UserNotifications] Preferences disabled for ${subscriber.email}`)
            skipped++
            continue
          }

          // Generate unsubscribe token
          const unsubscribeToken = await subscriptionService.generateUnsubscribeToken(
            subscriber.memberId,
            postId,
            'unsubscribe_post'
          )

          // Build URLs
          const postUrl = boardSlug
            ? `${rootUrl}/b/${boardSlug}/posts/${postId}`
            : `${rootUrl}/posts/${postId}`
          const unsubscribeUrl = `${rootUrl}/unsubscribe?token=${unsubscribeToken}`

          try {
            await sendNewCommentEmail({
              to: subscriber.email,
              postTitle: commentData.post.title,
              postUrl,
              commenterName,
              commentPreview,
              isTeamMember,
              workspaceName: org.name,
              unsubscribeUrl,
            })
            emailsSent++
            console.log(`[UserNotifications] Sent new comment email to ${subscriber.email}`)
          } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error'
            errors.push(`Failed to email ${subscriber.email}: ${msg}`)
            console.error(`[UserNotifications] Failed to email ${subscriber.email}:`, error)
          }
        }
        break
      }

      default:
        console.log(`[UserNotifications] Ignoring unsupported event type: ${eventType}`)
    }

    console.log(
      `[UserNotifications] Completed: ${emailsSent} emails sent, ${skipped} skipped, ${errors.length} errors`
    )

    return { emailsSent, skipped, errors }
  } catch (error) {
    console.error(`[UserNotifications] Error processing job:`, error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return { emailsSent, skipped, errors: [...errors, msg] }
  }
}

/**
 * Check if we should skip notifying this subscriber because they're the actor
 */
function shouldSkipActor(
  subscriber: Subscriber,
  actor: { type: 'user' | 'system'; userId?: string; email?: string }
): boolean {
  if (actor.type === 'system') {
    return false
  }
  // Check by userId or email
  if (actor.userId && subscriber.userId === actor.userId) {
    return true
  }
  if (actor.email && subscriber.email === actor.email) {
    return true
  }
  return false
}

/**
 * Get the root URL for email links.
 * Requires ROOT_URL environment variable to be set.
 */
function getRootUrl(): string {
  const url = process.env.ROOT_URL
  if (!url) {
    throw new Error('ROOT_URL environment variable is required for email notifications')
  }
  return url
}

/**
 * Get board slug for a post (needed for URL generation)
 */
async function getPostBoardSlug(postId: PostId): Promise<string | null> {
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
    columns: { boardId: true },
    with: {
      board: {
        columns: { slug: true },
      },
    },
  })
  return post?.board?.slug || null
}

/**
 * Truncate text to a maximum length
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 3) + '...'
}

/**
 * Strip HTML tags from a string
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim()
}
