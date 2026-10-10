/**
 * ClickUp task formatting utilities.
 */

import type { EventData } from '@/lib/server/events/types'
import { buildIntegrationPostContent } from '@/lib/server/integrations/post-content'
import { buildPostUrl, getAuthorName } from '@/lib/server/integrations/message-utils'

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
  const postUrl = buildPostUrl(rootUrl, post.boardSlug, post.id)
  const content = buildIntegrationPostContent(post.content, rootUrl)
  const author = getAuthorName(post)

  const description = [
    content,
    '',
    '---',
    `**Submitted by:** ${author}`,
    `**Board:** ${post.boardSlug}`,
    `[View in Quackback](${postUrl})`,
  ].join('\n')

  return { name: post.title, description }
}
