/**
 * User notification job processor.
 * Sends email notifications to post subscribers when relevant events occur.
 */
import type { Job } from 'bullmq'
import { withTenantContext, db, eq, and, workspaceDomain, workspace, member } from '@quackback/db'
import type { UserNotificationJobData, UserNotificationJobResult } from '@quackback/jobs'
import { sendStatusChangeEmail, sendNewCommentEmail } from '@quackback/email'
import { SubscriptionService, type Subscriber } from '@quackback/domain/subscriptions'
import type { WorkspaceId } from '@quackback/ids'

interface StatusChangeEventData {
  post: { id: string; title: string; boardSlug: string }
  previousStatus: string
  newStatus: string
}

interface CommentCreatedEventData {
  comment: { id: string; content: string; authorEmail?: string }
  post: { id: string; title: string }
}

/**
 * Process a user notification job.
 * Looks up subscribers for the affected post and sends appropriate emails.
 */
export async function processUserNotificationJob(
  job: Job<UserNotificationJobData>
): Promise<UserNotificationJobResult> {
  const { eventId, eventType, organizationId, actor, data } = job.data

  console.log(`[UserNotifications] Processing ${eventType} event ${eventId}`)

  const subscriptionService = new SubscriptionService()
  const errors: string[] = []
  let emailsSent = 0
  let skipped = 0

  try {
    // Get organization details for email content
    const org = await db.query.workspace.findFirst({
      where: eq(workspace.id, organizationId),
      columns: { name: true },
    })

    if (!org) {
      console.error(`[UserNotifications] Workspace not found: ${organizationId}`)
      return { emailsSent: 0, skipped: 0, errors: ['Workspace not found'] }
    }

    // Get tenant URL for email links
    const tenantUrl = await getTenantUrl(organizationId)

    // Process based on event type
    switch (eventType) {
      case 'post.status_changed': {
        const eventData = data as StatusChangeEventData
        const postId = eventData.post.id

        // Get active subscribers for this post
        const subscribers = await subscriptionService.getActiveSubscribers(postId, organizationId)
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
          const prefs = await subscriptionService.getNotificationPreferences(
            subscriber.memberId,
            organizationId
          )
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
          const postUrl = `${tenantUrl}/b/${eventData.post.boardSlug}/posts/${postId}`
          const unsubscribeUrl = `${tenantUrl}/unsubscribe?token=${unsubscribeToken}`

          try {
            await sendStatusChangeEmail({
              to: subscriber.email,
              postTitle: eventData.post.title,
              postUrl,
              previousStatus: eventData.previousStatus,
              newStatus: eventData.newStatus,
              organizationName: org.name,
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
        const eventData = data as CommentCreatedEventData
        const postId = eventData.post.id

        // Get active subscribers for this post
        const subscribers = await subscriptionService.getActiveSubscribers(postId, organizationId)
        console.log(
          `[UserNotifications] Found ${subscribers.length} subscribers for post ${postId}`
        )

        // Get commenter info for the email
        const commenterName = eventData.comment.authorEmail?.split('@')[0] || 'Someone'
        const commentPreview = truncateText(stripHtml(eventData.comment.content), 200)

        // Check if commenter is a team member
        const commenterMember = actor.userId
          ? await db.query.member.findFirst({
              where: and(eq(member.userId, actor.userId), eq(member.workspaceId, organizationId)),
              columns: { role: true },
            })
          : null
        const isTeamMember = commenterMember?.role !== 'user'

        // Get board slug for URL (need to look it up since comment events don't include it)
        const boardSlug = await getPostBoardSlug(postId, organizationId)

        for (const subscriber of subscribers) {
          // Skip the actor (don't notify about own comments)
          if (shouldSkipActor(subscriber, actor)) {
            console.log(`[UserNotifications] Skipping actor ${subscriber.email}`)
            skipped++
            continue
          }

          // Check notification preferences
          const prefs = await subscriptionService.getNotificationPreferences(
            subscriber.memberId,
            organizationId
          )
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
            ? `${tenantUrl}/b/${boardSlug}/posts/${postId}`
            : `${tenantUrl}/posts/${postId}`
          const unsubscribeUrl = `${tenantUrl}/unsubscribe?token=${unsubscribeToken}`

          try {
            await sendNewCommentEmail({
              to: subscriber.email,
              postTitle: eventData.post.title,
              postUrl,
              commenterName,
              commentPreview,
              isTeamMember,
              organizationName: org.name,
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
 * Look up the primary workspace domain for an organization.
 * Returns the full URL including protocol.
 */
async function getTenantUrl(workspaceId: WorkspaceId): Promise<string> {
  const domain = await db.query.workspaceDomain.findFirst({
    where: and(eq(workspaceDomain.workspaceId, workspaceId), eq(workspaceDomain.isPrimary, true)),
  })

  if (domain) {
    const isLocalhost = domain.domain.includes('localhost')
    const protocol = isLocalhost ? 'http' : 'https'
    return `${protocol}://${domain.domain}`
  }

  // Fallback: use APP_DOMAIN
  const appDomain = process.env.APP_DOMAIN || 'localhost:3000'
  const isLocalhost = appDomain.includes('localhost')
  const protocol = isLocalhost ? 'http' : 'https'
  return `${protocol}://${appDomain}`
}

/**
 * Get board slug for a post (needed for URL generation)
 */
async function getPostBoardSlug(postId: string, workspaceId: WorkspaceId): Promise<string | null> {
  const result = await withTenantContext(workspaceId, async (txDb) => {
    const post = await txDb.query.posts.findFirst({
      where: (posts, { eq }) => eq(posts.id, postId),
      columns: { boardId: true },
      with: {
        board: {
          columns: { slug: true },
        },
      },
    })
    return post?.board?.slug || null
  })
  return result
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
