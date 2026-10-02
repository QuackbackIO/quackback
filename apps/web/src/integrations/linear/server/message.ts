/**
 * Linear issue formatting utilities.
 */

import type { CommentCreatedEvent, EventData } from '@/lib/server/events/types'
import { buildIntegrationPostContent } from '@/lib/server/integrations/post-content'
import { buildPostUrl, getAuthorName } from '@/lib/server/integrations/message-utils'

/**
 * Build a Linear issue title and description from a post.created event.
 */
export function buildLinearIssueBody(
  event: EventData,
  rootUrl: string
): { title: string; description: string } {
  if (event.type !== 'post.created') {
    return { title: 'Feedback', description: '' }
  }

  const { post } = event.data
  const postUrl = buildPostUrl(rootUrl, post.boardSlug, post.id)
  const content = buildIntegrationPostContent(post.content, rootUrl, { embedVideos: true })
  const author = getAuthorName(post)

  const description = [
    content,
    '',
    '---',
    `**Submitted by:** ${author}`,
    `**Board:** ${post.boardSlug}`,
    `[View in Quackback](${postUrl})`,
  ].join('\n')

  return { title: post.title, description }
}

/** Build the Linear comment body for a newly published public Quackback comment. */
export function buildLinearCommentBody(event: CommentCreatedEvent, rootUrl: string): string {
  const { comment, post } = event.data
  const author = getAuthorName(comment)
  const content = buildIntegrationPostContent(comment.content, rootUrl, {
    embedVideos: true,
    maxLength: 5000,
  })
  const commentUrl = `${buildPostUrl(rootUrl, post.boardSlug, post.id)}#comment-${comment.id}`

  return [
    `**${author} commented:**`,
    '',
    content,
    '',
    `[View comment in Quackback](${commentUrl})`,
  ].join('\n')
}
