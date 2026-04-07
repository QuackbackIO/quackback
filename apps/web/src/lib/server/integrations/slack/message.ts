/**
 * Slack message building utilities.
 * Creates Block Kit formatted messages for different event types.
 */

import type { EventData } from '../../events/types'
import { stripHtml, truncate, formatStatus, getStatusEmoji } from '../../events/hook-utils'
import { getAuthorName, buildPostUrl } from '../message-utils'

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
      const postUrl = buildPostUrl(rootUrl, post.boardSlug, post.id)
      const content = truncate(stripHtml(post.content), 300)
      const author = getAuthorName(post)

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
      const postUrl = buildPostUrl(rootUrl, post.boardSlug, post.id)
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

    case 'post.updated': {
      const { post, changedFields } = event.data
      const postUrl = buildPostUrl(rootUrl, post.boardSlug, post.id)
      const actor = event.actor.email || 'System'
      const fields = changedFields.join(', ')

      return {
        text: `Post updated by ${actor}: ${post.title}`,
        blocks: [
          {
            type: 'context',
            elements: [
              { type: 'mrkdwn', text: `✏️ Post updated by *${escapeSlackMrkdwn(actor)}*` },
            ],
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `> *<${postUrl}|${escapeSlackMrkdwn(post.title)}>*\n> Changed: ${escapeSlackMrkdwn(fields)}`,
            },
          },
        ],
      }
    }

    case 'post.deleted': {
      const { post } = event.data
      const actor = event.actor.email || 'System'

      return {
        text: `Post deleted by ${actor}: ${post.title}`,
        blocks: [
          {
            type: 'context',
            elements: [
              { type: 'mrkdwn', text: `🗑️ Post deleted by *${escapeSlackMrkdwn(actor)}*` },
            ],
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `> *${escapeSlackMrkdwn(post.title)}*`,
            },
          },
        ],
      }
    }

    case 'post.merged': {
      const { duplicatePost, canonicalPost } = event.data
      const canonicalUrl = buildPostUrl(rootUrl, canonicalPost.boardSlug, canonicalPost.id)
      const actor = event.actor.email || 'System'

      return {
        text: `Post merged by ${actor}: "${duplicatePost.title}" → "${canonicalPost.title}"`,
        blocks: [
          {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: `🔀 Post merged by *${escapeSlackMrkdwn(actor)}*` }],
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `> *${escapeSlackMrkdwn(duplicatePost.title)}* → *<${canonicalUrl}|${escapeSlackMrkdwn(canonicalPost.title)}>*`,
            },
          },
        ],
      }
    }

    case 'comment.created': {
      const { comment, post } = event.data
      const postUrl = buildPostUrl(rootUrl, post.boardSlug, post.id)
      const content = truncate(stripHtml(comment.content), 300)
      const author = getAuthorName(comment)

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

    case 'changelog.published': {
      const { changelog } = event.data
      const changelogUrl = `${rootUrl}/changelog`
      const content = truncate(stripHtml(changelog.contentPreview || ''), 300)
      const actor = event.actor.displayName || event.actor.email || 'System'

      return {
        text: `Changelog published: ${changelog.title}`,
        blocks: [
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `📢 Changelog published by *${escapeSlackMrkdwn(actor)}*`,
              },
            ],
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `> *<${changelogUrl}|${escapeSlackMrkdwn(changelog.title)}>*\n${quoteText(escapeSlackMrkdwn(content))}`,
            },
          },
        ],
      }
    }

    default:
      return { text: `Event: ${(event as { type: string }).type}` }
  }
}
