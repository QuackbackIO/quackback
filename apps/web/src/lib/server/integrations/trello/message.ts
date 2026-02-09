/**
 * Trello card content building utilities.
 */

import type { EventData } from '../../events/types'
import { stripHtml, truncate } from '../../events/hook-utils'

/**
 * Build card name and description for a Trello card.
 */
export function buildTrelloCard(
  event: EventData,
  rootUrl: string
): {
  name: string
  desc: string
} {
  if (event.type !== 'post.created') {
    return { name: '', desc: '' }
  }

  const { post } = event.data
  const postUrl = `${rootUrl}/b/${post.boardSlug}/posts/${post.id}`
  const content = truncate(stripHtml(post.content), 2000)
  const author = post.authorName || post.authorEmail || 'Anonymous'

  const desc = [
    `**Submitted by:** ${author}`,
    '',
    content,
    '',
    '---',
    `[View in Quackback](${postUrl})`,
  ].join('\n')

  return { name: post.title, desc }
}
