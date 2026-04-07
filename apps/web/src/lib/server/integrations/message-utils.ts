/**
 * Shared utilities for integration message builders.
 */

/**
 * Resolve author display name from post data, falling back to email or 'Anonymous'.
 */
export function getAuthorName(post: {
  authorName?: string | null
  authorEmail?: string | null
}): string {
  return post.authorName || post.authorEmail || 'Anonymous'
}

/**
 * Build the Quackback post URL.
 */
export function buildPostUrl(rootUrl: string, boardSlug: string, postId: string): string {
  return `${rootUrl}/b/${boardSlug}/posts/${postId}`
}

/**
 * Escape HTML special characters for safe embedding.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Extract error message from an unknown error value.
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}
