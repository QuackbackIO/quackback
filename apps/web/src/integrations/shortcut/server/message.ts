/**
 * Shortcut story formatting utilities.
 */

import type { EventData } from '@/lib/server/events/types'
import { stripHtml, truncate } from '@/lib/server/events/hook-utils'
import { getAuthorName, buildPostUrl } from '@/lib/server/integrations/message-utils'

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
  const postUrl = buildPostUrl(rootUrl, post.boardSlug, post.id)
  const content = truncate(stripHtml(post.content), 2000)
  const author = getAuthorName(post)

  const description = [
    content,
    '',
    '---',
    `**Submitted by:** ${author}`,
    `**Board:** ${post.boardSlug}`,
    `[View in Quackback](${postUrl})`,
  ].join('\n')

  const title = truncate(post.title, 512)
  return { title, description }
}
