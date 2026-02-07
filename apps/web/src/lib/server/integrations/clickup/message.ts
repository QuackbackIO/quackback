/**
 * ClickUp task formatting utilities.
 */

import type { EventData } from '../../events/types'
import { stripHtml, truncate } from '../../events/hook-utils'

/**
 * Build a ClickUp task name and Markdown description from a post.created event.
 */
export function buildClickUpTaskBody(
  event: EventData,
  rootUrl: string
): { name: string; description: string } {
  if (event.type !== 'post.created') {
    return { name: 'Feedback', description: '' }
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

  return { name: post.title, description }
}
