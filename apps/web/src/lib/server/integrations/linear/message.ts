/**
 * Linear issue formatting utilities.
 */

import type { EventData } from '../../events/types'
import { stripHtml, truncate } from '../../events/hook-utils'

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
  const postUrl = `${rootUrl}/b/${post.boardSlug}/posts/${post.id}`
  const content = truncate(stripHtml(post.content), 2000)
  const author = post.authorName || post.authorEmail || 'Anonymous'

  const description = [
    content,
    '',
    '---',
    `**Submitted by:** ${author}`,
    `**Board:** ${post.boardSlug}`,
    `**Votes:** ${post.voteCount}`,
    `[View in Quackback](${postUrl})`,
  ].join('\n')

  return { title: post.title, description }
}
