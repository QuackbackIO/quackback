/**
 * Field mapping utilities for Canny → Quackback conversion
 */

import type { ModerationState } from '../../schema/types'

/**
 * Normalize a Canny status string to a Quackback-compatible slug.
 * Canny statuses are freeform strings set by users.
 */
export function normalizeStatus(status: string): string {
  return status
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Determine moderation state from a Canny post.
 * Canny doesn't have a direct moderation concept - all posts are published.
 * Merged posts are archived since their canonical post is the active one.
 */
export function normalizeModeration(merged: boolean): ModerationState {
  if (merged) return 'archived'
  return 'published'
}

/**
 * Append image URLs as markdown image links to body text.
 */
export function embedImages(body: string, imageURLs: string[]): string {
  if (!imageURLs || imageURLs.length === 0) return body

  const imageMarkdown = imageURLs.map((url, i) => `![image ${i + 1}](${url})`).join('\n')
  return body ? `${body}\n\n${imageMarkdown}` : imageMarkdown
}
