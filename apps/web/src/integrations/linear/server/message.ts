/**
 * Linear issue formatting utilities.
 */

import type { CommentCreatedEvent, EventData, EventPostData } from '@/lib/server/events/types'
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
  return buildLinearIssueBodyFromPost(event.data.post, rootUrl)
}

/** Build the Linear issue title and description from the current post content. */
export function buildLinearIssueBodyFromPost(
  post: EventPostData,
  rootUrl: string
): { title: string; description: string } {
  const postUrl = buildPostUrl(rootUrl, post.boardSlug, post.id)
  const content = buildIntegrationPostContent(post.content, rootUrl, { embedVideos: true })
  const author = getAuthorName(post)

  const footer = joinFooterLines([
    `**Submitted by:** ${author}`,
    ...authorIdLines(post.authorPrincipalId, post.authorUserId),
    `**Board:** ${post.boardSlug}`,
    `[View in Quackback](${postUrl})`,
  ])

  return { title: post.title, description: [content, '', '---', footer].join('\n') }
}

/** Code-formatted principal and user ids, skipping whichever is unknown. */
function authorIdLines(principalId?: string, userId?: string): string[] {
  return [principalId, userId].filter(Boolean).map((id) => `\`${id}\``)
}

/**
 * One item per line; the trailing double space is a Markdown hard break so
 * renderers that join soft line breaks still keep the lines apart.
 */
function joinFooterLines(lines: string[]): string {
  return lines.join('  \n')
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
  const footer = joinFooterLines([
    ...authorIdLines(comment.authorPrincipalId, comment.authorUserId),
    `[View comment in Quackback](${commentUrl})`,
  ])

  return [`**${author} commented:**`, '', content, '', '---', footer].join('\n')
}
