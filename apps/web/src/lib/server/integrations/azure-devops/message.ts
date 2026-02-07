/**
 * Azure DevOps work item formatting utilities.
 * Produces HTML description (Azure DevOps supports HTML in System.Description).
 */

import type { EventData } from '../../events/types'
import { stripHtml, truncate } from '../../events/hook-utils'

export function buildAzureDevOpsWorkItemBody(
  event: EventData,
  rootUrl: string
): { title: string; description: string } {
  if (event.type !== 'post.created') {
    return { title: 'Feedback', description: '' }
  }

  const { post } = event.data
  const postUrl = `${rootUrl}/b/${post.boardSlug}/posts/${post.id}`
  const content = truncate(stripHtml(post.content), 2000)
  const author = post.authorName || post.authorEmail || 'Anonymous'

  const description = [
    `<p>${escapeHtml(content)}</p>`,
    '<hr>',
    `<p><strong>Submitted by:</strong> ${escapeHtml(author)}</p>`,
    `<p><strong>Board:</strong> ${escapeHtml(post.boardSlug)}</p>`,
    `<p><strong>Votes:</strong> ${post.voteCount}</p>`,
    `<p><a href="${escapeHtml(postUrl)}">View in Quackback</a></p>`,
  ].join('\n')

  return { title: post.title, description }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
