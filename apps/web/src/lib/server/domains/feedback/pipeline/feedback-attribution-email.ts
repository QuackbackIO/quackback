/**
 * Send an attribution email when external feedback is linked to a post.
 *
 * Looks up the user, skips synthetic emails, builds the post URL,
 * generates an unsubscribe token, and sends the email.
 * Never throws — failures are logged but don't block the accept flow.
 */

import { db, eq, principal, user, posts } from '@/lib/server/db'
import { getBaseUrl } from '@/lib/server/config'
import { generateUnsubscribeToken } from '@/lib/server/domains/subscriptions/subscription.service'
import { sendFeedbackLinkedEmail } from '@quackback/email'
import type { PrincipalId, PostId } from '@quackback/ids'

export async function sendFeedbackAttributionEmail(
  principalId: PrincipalId,
  postId: PostId,
  resolvedByPrincipalId?: PrincipalId
): Promise<void> {
  try {
    // Look up user email + name via principal
    const principalRow = await db.query.principal.findFirst({
      where: eq(principal.id, principalId),
      columns: { userId: true },
    })
    if (!principalRow?.userId) return

    const userRow = await db.query.user.findFirst({
      where: eq(user.id, principalRow.userId),
      columns: { email: true, name: true },
    })
    if (!userRow?.email) return

    // Skip synthetic emails that have no real inbox
    if (userRow.email.endsWith('@external.quackback.io')) return

    // Look up the team member who attributed the feedback
    let attributedByName: string | undefined
    if (resolvedByPrincipalId) {
      const resolverPrincipal = await db.query.principal.findFirst({
        where: eq(principal.id, resolvedByPrincipalId),
        columns: { userId: true },
      })
      if (resolverPrincipal?.userId) {
        const resolverUser = await db.query.user.findFirst({
          where: eq(user.id, resolverPrincipal.userId),
          columns: { name: true },
        })
        attributedByName = resolverUser?.name ?? undefined
      }
    }

    // Look up post title + board slug for URL
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, postId),
      columns: { title: true, boardId: true },
      with: { board: { columns: { slug: true } } },
    })
    if (!post) return

    // Get workspace name
    const workspace = await db.query.settings.findFirst({
      columns: { name: true },
    })
    const workspaceName = workspace?.name ?? 'Quackback'

    // Build post URL
    const baseUrl = getBaseUrl()
    const boardSlug = post.board?.slug ?? 'general'
    const postUrl = `${baseUrl}/b/${boardSlug}/posts/${postId}`

    // Generate unsubscribe token
    const token = await generateUnsubscribeToken(principalId, postId, 'unsubscribe_post')
    const unsubscribeUrl = `${baseUrl}/unsubscribe?token=${token}`

    await sendFeedbackLinkedEmail({
      to: userRow.email,
      recipientName: userRow.name ?? undefined,
      postTitle: post.title,
      postUrl,
      workspaceName,
      unsubscribeUrl,
      attributedByName,
    })
  } catch (error) {
    // Never fail the accept flow due to email errors
    console.warn(
      `[FeedbackAttribution] Failed to send attribution email:`,
      error instanceof Error ? error.message : String(error)
    )
  }
}
