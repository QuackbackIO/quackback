/**
 * Shared utilities for hooks.
 *
 * stripHtml, truncate, formatStatus, getStatusEmoji are canonical in
 * @/lib/shared/utils/string and re-exported here for existing consumers.
 */

export { stripHtml, truncate, formatStatus, getStatusEmoji } from '@/lib/shared/utils/string'

const RETRYABLE_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
  'ConnectionRefused', // Bun's fetch error code
])

/**
 * Check if an error is retryable (network issues, rate limits, server errors).
 * Checks both `status` and `code` sequentially so errors with both properties
 * are fully evaluated.
 */
export function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  // AbortError from fetch timeout
  if (error instanceof Error && error.name === 'AbortError') return true

  if ('status' in error) {
    const status = Number((error as { status: unknown }).status)
    if (status === 429 || (status >= 500 && status < 600)) return true
  }

  if ('code' in error) {
    const code = String((error as { code: unknown }).code)
    if (RETRYABLE_CODES.has(code)) return true
  }

  return false
}
