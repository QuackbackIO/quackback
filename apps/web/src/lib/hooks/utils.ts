/**
 * Shared utilities for hooks.
 */

/**
 * Strip HTML tags from text.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim()
}

/**
 * Truncate text to a maximum length with ellipsis.
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 3) + '...'
}

/**
 * Get the root URL for links.
 */
export function getRootUrl(): string {
  const url = process.env.ROOT_URL
  if (!url) {
    throw new Error('ROOT_URL environment variable is required')
  }
  return url
}

/**
 * Check if an error is retryable (network issues, rate limits, server errors).
 */
export function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  // Check for HTTP status codes
  if ('status' in error) {
    const status = (error as { status?: number }).status
    // 429 (rate limit), 500-599 (server errors)
    return status === 429 || (status !== undefined && status >= 500 && status < 600)
  }

  // Check for network errors
  if ('code' in error) {
    const code = (error as { code?: string }).code
    return code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND'
  }

  return false
}

/**
 * Format a status name for display (e.g., "in_progress" -> "In Progress").
 */
export function formatStatus(status: string): string {
  return status
    .split(/[_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

/**
 * Get an emoji for a status.
 */
export function getStatusEmoji(status: string): string {
  const map: Record<string, string> = {
    open: '📥',
    under_review: '👀',
    planned: '📅',
    in_progress: '🚧',
    complete: '✅',
    closed: '🔒',
  }
  return map[status.toLowerCase().replace(/\s+/g, '_')] || '📌'
}
