/**
 * ClickUp task formatting utilities.
 */

import type { EventData } from '../../events/types'
import { stripHtml, truncate } from '../../events/hook-utils'
import { buildPostUrl, getAuthorName } from '../message-utils'

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

  return { name: post.title, description }
}
