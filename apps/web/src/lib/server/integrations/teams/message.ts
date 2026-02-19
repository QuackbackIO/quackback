/**
 * Teams message building utilities.
 * Creates Adaptive Card formatted messages for the Graph API chatMessage resource.
 *
 * Graph API requires:
 * - body.contentType = "html" with <attachment id="..."></attachment> references
 * - attachments[].id matching the reference in body
 * - attachments[].content as a JSON string (not an object)
 *
 * See: https://learn.microsoft.com/en-us/graph/api/channel-post-messages
 */

import type { EventData } from '../../events/types'
import { stripHtml, truncate, formatStatus, getStatusEmoji } from '../../events/hook-utils'

interface TeamsMessage {
  body: { contentType: 'html'; content: string }
  attachments: Array<{
    id: string
    contentType: 'application/vnd.microsoft.card.adaptive'
    contentUrl: null
    content: string
  }>
}

function textBlock(text: string, opts?: { weight?: string; size?: string; color?: string }) {
  return { type: 'TextBlock', text, wrap: true, ...opts }
}

function buildCard(body: unknown[], actions?: unknown[]): TeamsMessage {
  const cardId = '74d20c7f58e4'
  const card = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body,
    ...(actions ? { actions } : {}),
  }

  return {
    body: {
      contentType: 'html',
      content: `<attachment id="${cardId}"></attachment>`,
    },
    attachments: [
      {
        id: cardId,
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: JSON.stringify(card),
      },
    ],
  }
}

/**
 * Build a Teams Adaptive Card message for an event.
 */
export function buildTeamsMessage(event: EventData, rootUrl: string): TeamsMessage {
  switch (event.type) {
    case 'post.created': {
      const { post } = event.data
      const postUrl = `${rootUrl}/b/${post.boardSlug}/posts/${post.id}`
      const content = truncate(stripHtml(post.content), 300)
      const author = post.authorName || post.authorEmail || 'Anonymous'

      return buildCard(
        [
          textBlock(`📬 New feedback from ${author}`, { weight: 'Bolder', size: 'Small' }),
          textBlock(post.title, { weight: 'Bolder', size: 'Medium' }),
          ...(content ? [textBlock(content)] : []),
          textBlock(`Board: ${post.boardSlug}`, { size: 'Small', color: 'Accent' }),
        ],
        [{ type: 'Action.OpenUrl', title: 'View in Portal', url: postUrl }]
      )
    }

    case 'post.status_changed': {
      const { post, previousStatus, newStatus } = event.data
      const postUrl = `${rootUrl}/b/${post.boardSlug}/posts/${post.id}`
      const emoji = getStatusEmoji(newStatus)
      const actor = event.actor.email || 'System'

      return buildCard(
        [
          textBlock(`${emoji} Status changed by ${actor}`, { weight: 'Bolder', size: 'Small' }),
          textBlock(post.title, { weight: 'Bolder', size: 'Medium' }),
          textBlock(`${formatStatus(previousStatus)} → **${formatStatus(newStatus)}**`),
        ],
        [{ type: 'Action.OpenUrl', title: 'View in Portal', url: postUrl }]
      )
    }

    case 'post.deleted': {
      const { post } = event.data
      const actor = event.actor.email || 'System'

      return buildCard([
        textBlock(`🗑️ Post deleted by ${actor}`, { weight: 'Bolder', size: 'Small' }),
        textBlock(post.title, { weight: 'Bolder', size: 'Medium' }),
      ])
    }

    case 'comment.created': {
      const { comment, post } = event.data
      const postUrl = `${rootUrl}/b/${post.boardSlug}/posts/${post.id}`
      const content = truncate(stripHtml(comment.content), 300)
      const author = comment.authorName || comment.authorEmail || 'Anonymous'

      return buildCard(
        [
          textBlock(`💬 New comment from ${author}`, { weight: 'Bolder', size: 'Small' }),
          textBlock(post.title, { weight: 'Bolder', size: 'Medium' }),
          ...(content ? [textBlock(content)] : []),
        ],
        [{ type: 'Action.OpenUrl', title: 'View in Portal', url: postUrl }]
      )
    }

    default:
      return buildCard([textBlock(`Event: ${(event as { type: string }).type}`)])
  }
}
