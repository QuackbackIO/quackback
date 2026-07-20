/**
 * Generic webhook payload formatting (Zapier / Make / n8n).
 * Sends a structured JSON payload that Zapier can parse.
 */

import type { EventData } from '@/lib/server/events/types'
import { stripHtml, truncate, formatStatus } from '@/lib/server/events/hook-utils'

interface WebhookPayload {
  event: string
  timestamp: string
  portal_url: string
  post: {
    id: string
    title: string
    content?: string
    board: string
    url: string
    author_name?: string
    author_email?: string
  }
  status_change?: {
    previous: string
    new: string
  }
  comment?: {
    id: string
    content: string
    author_name?: string
    author_email?: string
  }
  deleted_by?: string
}

/**
 * Build a generic JSON payload from an event.
 */
export function buildWebhookPayload(event: EventData, rootUrl: string): WebhookPayload {
  switch (event.type) {
    case 'post.created': {
      const { post } = event.data
      return {
        event: 'post.created',
        timestamp: event.timestamp,
        portal_url: rootUrl,
        post: {
          id: post.id,
          title: post.title,
          content: truncate(stripHtml(post.content), 1000),
          board: post.boardSlug,
          url: `${rootUrl}/b/${post.boardSlug}/posts/${post.id}`,
          author_name: post.authorName,
          author_email: post.authorEmail,
        },
      }
    }

    case 'post.status_changed': {
      const { post, previousStatus, newStatus } = event.data
      return {
        event: 'post.status_changed',
        timestamp: event.timestamp,
        portal_url: rootUrl,
        post: {
          id: post.id,
          title: post.title,
          board: post.boardSlug,
          url: `${rootUrl}/b/${post.boardSlug}/posts/${post.id}`,
        },
        status_change: {
          previous: formatStatus(previousStatus),
          new: formatStatus(newStatus),
        },
      }
    }

    case 'post.deleted': {
      const { post, deletedBy } = event.data
      return {
        event: 'post.deleted',
        timestamp: event.timestamp,
        portal_url: rootUrl,
        post: {
          id: post.id,
          title: post.title,
          board: post.boardSlug,
          url: `${rootUrl}/b/${post.boardSlug}/posts/${post.id}`,
        },
        deleted_by: deletedBy,
      }
    }

    case 'comment.created': {
      const { comment, post } = event.data
      return {
        event: 'comment.created',
        timestamp: event.timestamp,
        portal_url: rootUrl,
        post: {
          id: post.id,
          title: post.title,
          board: post.boardSlug,
          url: `${rootUrl}/b/${post.boardSlug}/posts/${post.id}`,
        },
        comment: {
          id: comment.id,
          content: truncate(stripHtml(comment.content), 1000),
          author_name: comment.authorName,
          author_email: comment.authorEmail,
        },
      }
    }

    default:
      return {
        event: (event as { type: string }).type,
        timestamp: new Date().toISOString(),
        portal_url: rootUrl,
        post: { id: '', title: '', board: '', url: '' },
      }
  }
}
