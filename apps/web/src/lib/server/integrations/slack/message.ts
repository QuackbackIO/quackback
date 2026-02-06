/**
 * Slack message building utilities.
 * Creates Block Kit formatted messages for different event types.
 */

import type { EventData } from '../../events/types'
import { stripHtml, truncate, formatStatus, getStatusEmoji } from '../../events/hook-utils'

interface SlackMessage {
  text: string
  blocks?: unknown[]
}

const MRKDWN_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
}

/**
 * Escape special characters for Slack mrkdwn format.
 */
export function escapeSlackMrkdwn(text: string): string {
  return text.replace(/[&<>]/g, (char) => MRKDWN_ESCAPE_MAP[char] ?? char)
}

/**
 * Format text as a Slack quote block by prefixing each line with '>'.
 */
function quoteText(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}

/**
 * Build a Slack message for an event.
 * @param event - The event data
 * @param rootUrl - Portal base URL for constructing post links
 */
export function buildSlackMessage(event: EventData, rootUrl: string): SlackMessage {
  switch (event.type) {
    case 'post.created': {
      const { post } = event.data
      const postUrl = `${rootUrl}/b/${post.boardSlug}/posts/${post.id}`
      const content = truncate(stripHtml(post.content), 300)
      const author = post.authorName || post.authorEmail || 'Anonymous'

      return {
        text: `New feedback from ${author}: ${post.title}`,
        blocks: [
          {
            type: 'context',
            elements: [
              { type: 'mrkdwn', text: `📬 New feedback from *${escapeSlackMrkdwn(author)}*` },
            ],
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `> *<${postUrl}|${escapeSlackMrkdwn(post.title)}>*\n${quoteText(escapeSlackMrkdwn(content))}`,
            },
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `in <${rootUrl}/?board=${post.boardSlug}|${escapeSlackMrkdwn(post.boardSlug)}>`,
              },
            ],
          },
        ],
      }
    }

    case 'post.status_changed': {
      const { post, previousStatus, newStatus } = event.data
      const postUrl = `${rootUrl}/b/${post.boardSlug}/posts/${post.id}`
      const emoji = getStatusEmoji(newStatus)
      const actor = event.actor.email || 'System'

      return {
        text: `Status changed on "${post.title}": ${formatStatus(previousStatus)} → ${formatStatus(newStatus)}`,
        blocks: [
          {
            type: 'context',
            elements: [
              { type: 'mrkdwn', text: `${emoji} Status changed by *${escapeSlackMrkdwn(actor)}*` },
            ],
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `> *<${postUrl}|${escapeSlackMrkdwn(post.title)}>*\n> ${formatStatus(previousStatus)} → *${formatStatus(newStatus)}*`,
            },
          },
        ],
      }
    }

    case 'comment.created': {
      const { comment, post } = event.data
      const postUrl = `${rootUrl}/b/${post.boardSlug}/posts/${post.id}`
      const content = truncate(stripHtml(comment.content), 300)
      const author = comment.authorName || comment.authorEmail || 'Anonymous'

      return {
        text: `New comment from ${author} on "${post.title}"`,
        blocks: [
          {
            type: 'context',
            elements: [
              { type: 'mrkdwn', text: `💬 New comment from *${escapeSlackMrkdwn(author)}*` },
            ],
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `> *<${postUrl}|${escapeSlackMrkdwn(post.title)}>*\n${quoteText(escapeSlackMrkdwn(content))}`,
            },
          },
        ],
      }
    }

    default:
      return { text: `Event: ${(event as { type: string }).type}` }
  }
}
