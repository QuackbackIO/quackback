/**
 * Shortcut story formatting utilities.
 */

import type { EventData } from '../../events/types'
import { stripHtml, truncate } from '../../events/hook-utils'

/**
 * Build a Shortcut story title and description from a post.created event.
 * Shortcut stories use Markdown formatting.
 */
export function buildShortcutStoryBody(
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

  // Shortcut story name has a 512 char max
  const title = post.title.length > 512 ? post.title.slice(0, 509) + '...' : post.title
  return { title, description }
}
