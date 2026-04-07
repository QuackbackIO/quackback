/**
 * Asana task formatting utilities.
 *
 * Asana task notes support a subset of HTML tags.
 * See: https://developers.asana.com/docs/rich-text
 */

import type { EventData } from '../../events/types'
import { stripHtml, truncate } from '../../events/hook-utils'
import { buildPostUrl, escapeHtml, getAuthorName } from '../message-utils'

/**
 * Build an Asana task name and HTML notes body from a post.created event.
 */
export function buildAsanaTaskBody(
  event: EventData,
  rootUrl: string
): { name: string; htmlNotes: string } {
  if (event.type !== 'post.created') {
    return { name: 'Feedback', htmlNotes: '' }
  }

  const { post } = event.data
  const postUrl = buildPostUrl(rootUrl, post.boardSlug, post.id)
  const content = truncate(stripHtml(post.content), 2000)
  const author = getAuthorName(post)

  const htmlNotes = [
    '<body>',
    `<p>${escapeHtml(content)}</p>`,
    '<hr/>',
    `<p><strong>Submitted by:</strong> ${escapeHtml(author)}</p>`,
    `<p><strong>Board:</strong> ${escapeHtml(post.boardSlug)}</p>`,
    `<p><a href="${postUrl}">View in Quackback</a></p>`,
    '</body>',
  ].join('\n')

  return { name: post.title, htmlNotes }
}
