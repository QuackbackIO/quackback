/**
 * Trello card content building utilities.
 */

import type { EventData } from '@/lib/server/events/types'
import { buildIntegrationPostContent } from '@/lib/server/integrations/post-content'
import { buildPostUrl, getAuthorName } from '@/lib/server/integrations/message-utils'

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
  const postUrl = buildPostUrl(rootUrl, post.boardSlug, post.id)
  const content = buildIntegrationPostContent(post.content, rootUrl)
  const author = getAuthorName(post)

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
