/**
 * GitHub issue formatting utilities.
 */

import type { EventData } from '@/lib/server/events/types'
import { buildIntegrationPostContent } from '@/lib/server/integrations/post-content'
import { buildPostUrl, getAuthorName } from '@/lib/server/integrations/message-utils'
import type { SectionOrigins } from '@/lib/shared/section-links'

/**
 * Build a GitHub issue title and body from a post.created event.
 */
export function buildGitHubIssueBody(
  event: EventData,
  links: SectionOrigins
): { title: string; body: string } {
  if (event.type !== 'post.created') {
    return { title: 'Feedback', body: '' }
  }

  const { post } = event.data
  const postUrl = buildPostUrl(links, post.boardSlug, post.id)
  const content = buildIntegrationPostContent(post.content, links.primary)
  const author = getAuthorName(post)

  const body = [
    content,
    '',
    '---',
    '',
    `**Submitted by:** ${author}`,
    `**Board:** ${post.boardSlug}`,
    '',
    `[View in Quackback](${postUrl})`,
  ].join('\n')

  return { title: post.title, body }
}
