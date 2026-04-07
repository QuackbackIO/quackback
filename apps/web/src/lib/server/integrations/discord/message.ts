/**
 * Discord message building utilities.
 * Creates embed-formatted messages for different event types.
 */

import type { EventData } from '../../events/types'
import { stripHtml, truncate, formatStatus, getStatusEmoji } from '../../events/hook-utils'
import { getAuthorName, buildPostUrl } from '../message-utils'

interface DiscordEmbed {
  title?: string
  description?: string
  url?: string
  color?: number
  author?: { name: string }
  fields?: Array<{ name: string; value: string; inline?: boolean }>
  footer?: { text: string }
  timestamp?: string
}

interface DiscordMessage {
  content?: string
  embeds?: DiscordEmbed[]
}

/** Discord embed colors */
const COLORS = {
  blue: 0x5865f2,
  green: 0x57f287,
  yellow: 0xfee75c,
  orange: 0xf0b232,
  grey: 0x99aab5,
} as const

function getStatusColor(status: string): number {
  const map: Record<string, number> = {
    open: COLORS.blue,
    under_review: COLORS.yellow,
    planned: COLORS.orange,
    in_progress: COLORS.yellow,
    complete: COLORS.green,
    closed: COLORS.grey,
  }
  return map[status.toLowerCase().replace(/\s+/g, '_')] ?? COLORS.blue
}

/**
 * Build a Discord message for an event.
 */
export function buildDiscordMessage(event: EventData, rootUrl: string): DiscordMessage {
  switch (event.type) {
    case 'post.created': {
      const { post } = event.data
      const postUrl = buildPostUrl(rootUrl, post.boardSlug, post.id)
      const content = truncate(stripHtml(post.content), 300)
      const author = getAuthorName(post)

      return {
        embeds: [
          {
            title: truncate(post.title, 256),
            url: postUrl,
            description: content || undefined,
            color: COLORS.blue,
            author: { name: `📬 New feedback from ${author}` },
            footer: { text: `Board: ${post.boardSlug}` },
            timestamp: event.timestamp,
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
        embeds: [
          {
            title: truncate(post.title, 256),
            url: postUrl,
            description: `${formatStatus(previousStatus)} → **${formatStatus(newStatus)}**`,
            color: getStatusColor(newStatus),
            author: { name: `${emoji} Status changed by ${actor}` },
            timestamp: event.timestamp,
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
        embeds: [
          {
            title: truncate(post.title, 256),
            url: postUrl,
            description: `Changed: ${fields}`,
            color: COLORS.yellow,
            author: { name: `✏️ Post updated by ${actor}` },
            timestamp: event.timestamp,
          },
        ],
      }
    }

    case 'post.deleted': {
      const { post } = event.data
      const actor = event.actor.email || 'System'

      return {
        embeds: [
          {
            title: truncate(post.title, 256),
            color: COLORS.grey,
            author: { name: `🗑️ Post deleted by ${actor}` },
            timestamp: event.timestamp,
          },
        ],
      }
    }

    case 'post.merged': {
      const { duplicatePost, canonicalPost } = event.data
      const canonicalUrl = buildPostUrl(rootUrl, canonicalPost.boardSlug, canonicalPost.id)
      const actor = event.actor.email || 'System'

      return {
        embeds: [
          {
            title: truncate(canonicalPost.title, 256),
            url: canonicalUrl,
            description: `"${duplicatePost.title}" merged into this post`,
            color: COLORS.orange,
            author: { name: `🔀 Post merged by ${actor}` },
            timestamp: event.timestamp,
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
        embeds: [
          {
            title: truncate(post.title, 256),
            url: postUrl,
            description: content || undefined,
            color: COLORS.blue,
            author: { name: `💬 New comment from ${author}` },
            timestamp: event.timestamp,
          },
        ],
      }
    }

    default:
      return { content: `Quackback event: ${(event as EventData).type}` }
  }
}
