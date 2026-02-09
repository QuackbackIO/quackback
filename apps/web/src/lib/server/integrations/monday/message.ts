/**
 * Monday.com item content building utilities.
 */

import type { EventData } from '../../events/types'
import { stripHtml, truncate } from '../../events/hook-utils'

/**
 * Build item name and update body for a Monday.com item.
 */
export function buildMondayItem(
  event: EventData,
  rootUrl: string
): {
  name: string
  updateBody: string
} {
  if (event.type !== 'post.created') {
    return { name: '', updateBody: '' }
  }

  const { post } = event.data
  const postUrl = `${rootUrl}/b/${post.boardSlug}/posts/${post.id}`
  const content = truncate(stripHtml(post.content), 2000)
  const author = post.authorName || post.authorEmail || 'Anonymous'

  const updateBody = [
    `Submitted by ${author}`,
    '',
    content,
    '',
    `View in Quackback: ${postUrl}`,
  ].join('\n')

  return { name: post.title, updateBody }
}
