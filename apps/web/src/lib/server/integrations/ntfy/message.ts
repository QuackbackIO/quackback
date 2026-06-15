/**
 * ntfy push notification payload formatting.
 */
import type { EventData } from '../../events/types'
import { stripHtml, truncate } from '../../events/hook-utils'

export interface NtfyPayload {
  topic: string
  title: string
  message: string
  click?: string
  tags?: string[]
}

export function buildNtfyPayload(event: EventData, topic: string, rootUrl: string): NtfyPayload | null {
  switch (event.type) {
    case 'post.created': {
      const { post } = event.data
      const body = truncate(stripHtml(post.content ?? ''), 500)
      return {
        topic,
        title: `New feedback: ${post.title}`,
        message: body || post.title,
        click: `${rootUrl}/b/${post.boardSlug}/posts/${post.id}`,
        tags: ['speech_balloon'],
      }
    }

    case 'post.status_changed': {
      const { post, previousStatus, newStatus } = event.data
      return {
        topic,
        title: `Status changed: ${post.title}`,
        message: `${previousStatus} → ${newStatus}`,
        click: `${rootUrl}/b/${post.boardSlug}/posts/${post.id}`,
        tags: ['arrows_counterclockwise'],
      }
    }

    case 'comment.created': {
      const { comment, post } = event.data
      const body = truncate(stripHtml(comment.content ?? ''), 500)
      return {
        topic,
        title: `New comment: ${post.title}`,
        message: body || `New comment on "${post.title}"`,
        click: `${rootUrl}/b/${post.boardSlug}/posts/${post.id}`,
        tags: ['speech_balloon'],
      }
    }

    default:
      return null
  }
}
