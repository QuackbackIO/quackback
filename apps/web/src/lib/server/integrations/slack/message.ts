/**
 * Slack message building utilities.
 * Creates Block Kit formatted messages for different event types.
 */

import type { EventData } from '../../events/types'
import { stripHtml, formatStatus, getStatusEmoji } from '../../events/hook-utils'

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
      const content = stripHtml(post.content)
      const author = post.authorName || post.authorEmail || 'Anonymous'

      return {
        text: `New post from ${author}: ${post.title}`,
        blocks: [
          {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: `📬 New post from ${author}` }],
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
                text: `in <${rootUrl}/?board=${post.boardSlug}|${post.boardSlug}>`,
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
        text: `Status updated by ${actor}: ${post.title}`,
        blocks: [
          {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: `${emoji} Status updated by ${actor}` }],
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
      const content = stripHtml(comment.content)
      const author = comment.authorName || comment.authorEmail || 'Anonymous'

      return {
        text: `New comment from ${author}: ${post.title}`,
        blocks: [
          {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: `💬 New comment from ${author}` }],
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
