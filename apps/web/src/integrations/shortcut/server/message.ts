/**
 * Shortcut story formatting utilities.
 */

import type { EventData } from '@/lib/server/events/types'
import { buildIntegrationPostContent } from '@/lib/server/integrations/post-content'
import { truncate } from '@/lib/server/events/hook-utils'
import { getAuthorName, buildPostUrl } from '@/lib/server/integrations/message-utils'
import type { SectionOrigins } from '@/lib/shared/section-links'

/**
 * Build a Shortcut story title and description from a post.created event.
 * Shortcut stories use Markdown formatting.
 */
export function buildShortcutStoryBody(
  event: EventData,
  links: SectionOrigins
): { title: string; description: string } {
  if (event.type !== 'post.created') {
    return { title: 'Feedback', description: '' }
  }

  const { post } = event.data
  const postUrl = buildPostUrl(links, post.boardSlug, post.id)
  const content = buildIntegrationPostContent(post.content, links.primary)
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
