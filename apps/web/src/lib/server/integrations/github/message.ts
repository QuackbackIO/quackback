/**
 * GitHub issue formatting utilities.
 */

import type { EventData } from '../../events/types'
import { stripHtml, truncate } from '../../events/hook-utils'

/**
 * Build a GitHub issue title and body from a post.created event.
 */
export function buildGitHubIssueBody(
  event: EventData,
  rootUrl: string
): { title: string; body: string } {
  if (event.type !== 'post.created') {
    return { title: 'Feedback', body: '' }
  }

  const { post } = event.data
  const postUrl = `${rootUrl}/b/${post.boardSlug}/posts/${post.id}`
  const content = truncate(stripHtml(post.content), 2000)
  const author = post.authorName || post.authorEmail || 'Anonymous'

  const body = [
    content,
    '',
    '---',
    '',
    `**Submitted by:** ${author}`,
    `**Board:** ${post.boardSlug}`,
    `**Votes:** ${post.voteCount}`,
    '',
    `[View in Quackback](${postUrl})`,
  ].join('\n')

  return { title: post.title, body }
}
