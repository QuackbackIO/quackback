/**
 * Notion page content building utilities.
 * Creates rich block content for Notion database pages.
 */

import type { EventData } from '../../events/types'
import { stripHtml, truncate } from '../../events/hook-utils'

interface NotionBlock {
  object: 'block'
  type: string
  [key: string]: unknown
}

/**
 * Build page properties and content blocks for a Notion database item.
 */
export function buildNotionPage(
  event: EventData,
  rootUrl: string
): {
  title: string
  description: string
  blocks: NotionBlock[]
} {
  if (event.type !== 'post.created') {
    return { title: '', description: '', blocks: [] }
  }

  const { post } = event.data
  const postUrl = `${rootUrl}/b/${post.boardSlug}/posts/${post.id}`
  const content = truncate(stripHtml(post.content), 2000)
  const author = post.authorName || post.authorEmail || 'Anonymous'

  const blocks: NotionBlock[] = [
    {
      object: 'block',
      type: 'callout',
      callout: {
        icon: { type: 'emoji', emoji: '📬' },
        rich_text: [
          {
            type: 'text',
            text: { content: `Submitted by ${author}` },
          },
        ],
      },
    },
  ]

  if (content) {
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content } }],
      },
    })
  }

  blocks.push(
    {
      object: 'block',
      type: 'divider',
      divider: {},
    },
    {
      object: 'block',
      type: 'bookmark',
      bookmark: { url: postUrl },
    }
  )

  return { title: post.title, description: content, blocks }
}
