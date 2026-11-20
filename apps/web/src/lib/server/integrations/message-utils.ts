/**
 * Shared utilities for integration message builders.
 */
import { allOnPrimary, sectionUrl, type SectionOrigins } from '@/lib/shared/section-links'

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
 * Build the Quackback post URL, on the feedback section's own host when it has one.
 */
export function buildPostUrl(links: SectionOrigins, boardSlug: string, postId: string): string {
  return sectionUrl('feedback', `/b/${boardSlug}/posts/${postId}`, links)
}

/**
 * Where an integration hook links: the section origins the dispatcher passed,
 * else every section at `rootUrl`, the primary origin.
 */
export function hookLinks(config: { rootUrl: string; links?: SectionOrigins }): SectionOrigins {
  return config.links ?? allOnPrimary(config.rootUrl)
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

/**
 * Shape an issue-tracker error: a user-facing message plus the optional
 * `retryable`/`status` fields the create hooks read back off it (see
 * IssueTrackerCapability.create).
 */
export function issueError(
  message: string,
  opts: { retryable?: boolean; status?: number } = {}
): Error {
  return Object.assign(new Error(message), opts)
}
