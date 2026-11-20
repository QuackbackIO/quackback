/**
 * ntfy push notification payload formatting.
 */
import type { EventData } from '@/lib/server/events/types'
import { stripHtml, truncate, formatStatus } from '@/lib/server/events/hook-utils'
import { commentPlainText } from '@/lib/server/markdown-tiptap'
import { buildPostUrl } from '@/lib/server/integrations/message-utils'
import type { SectionOrigins } from '@/lib/shared/section-links'

export interface NtfyPayload {
  topic: string
  title: string
  message: string
  click?: string
  tags?: string[]
}

export function buildNtfyPayload(
  event: EventData,
  topic: string,
  links: SectionOrigins
): NtfyPayload | null {
  switch (event.type) {
    case 'post.created': {
      const { post } = event.data
      const body = truncate(stripHtml(post.content ?? ''), 500)
      return {
        topic,
        title: `New feedback: ${post.title}`,
        message: body || post.title,
        click: buildPostUrl(links, post.boardSlug, post.id),
        tags: ['speech_balloon'],
      }
    }

    case 'post.status_changed': {
      const { post, previousStatus, newStatus } = event.data
      return {
        topic,
        title: `Status changed: ${post.title}`,
        message: `${formatStatus(previousStatus)} → ${formatStatus(newStatus)}`,
        click: buildPostUrl(links, post.boardSlug, post.id),
        tags: ['arrows_counterclockwise'],
      }
    }

    case 'comment.created': {
      const { comment, post } = event.data
      const body = truncate(commentPlainText(comment), 500)
      return {
        topic,
        title: `New comment: ${post.title}`,
        message: body || `New comment on "${post.title}"`,
        click: buildPostUrl(links, post.boardSlug, post.id),
        tags: ['speech_balloon'],
      }
    }

    default:
      return null
  }
}
