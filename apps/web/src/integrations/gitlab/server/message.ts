/**
 * GitLab issue content building utilities.
 */

import type { EventData } from '@/lib/server/events/types'
import { buildIntegrationPostContent } from '@/lib/server/integrations/post-content'
import { buildPostUrl, getAuthorName } from '@/lib/server/integrations/message-utils'

/**
 * Build issue title and description for a GitLab issue.
 */
export function buildGitLabIssue(
  event: EventData,
  rootUrl: string
): {
  title: string
  description: string
} {
  if (event.type !== 'post.created') {
    return { title: '', description: '' }
  }

  const { post } = event.data
  const postUrl = buildPostUrl(rootUrl, post.boardSlug, post.id)
  const content = buildIntegrationPostContent(post.content, rootUrl)
  const author = getAuthorName(post)

  const description = [
    `> Submitted by **${author}** via [Quackback](${postUrl})`,
    '',
    content,
    '',
    '---',
    `[View original feedback](${postUrl})`,
  ].join('\n')

  return { title: post.title, description }
}
