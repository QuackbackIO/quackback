/**
 * Azure DevOps work item formatting utilities.
 * Produces HTML description (Azure DevOps supports HTML in System.Description).
 */

import type { EventData } from '../../events/types'
import { buildPostUrl, escapeHtml } from '../message-utils'

export function buildAzureDevOpsWorkItemBody(
  event: EventData,
  rootUrl: string
): { title: string; description: string } {
  if (event.type !== 'post.status_changed') {
    return { title: 'Feedback', description: '' }
  }

  const { post, previousStatus, newStatus } = event.data
  const postUrl = buildPostUrl(rootUrl, post.boardSlug, post.id)

  const description = [
    `<p><strong>Status:</strong> ${escapeHtml(previousStatus)} &rarr; ${escapeHtml(newStatus)}</p>`,
    `<p><strong>Board:</strong> ${escapeHtml(post.boardSlug)}</p>`,
    `<p><a href="${escapeHtml(postUrl)}">View in Quackback</a></p>`,
  ].join('\n')

  return { title: post.title, description }
}
