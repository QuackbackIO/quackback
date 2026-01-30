/**
 * Webhook hook exports and utilities.
 */

export { webhookHook } from './handler'
export type { WebhookTarget, WebhookConfig } from './handler'

// ============================================
// URL Validation (SSRF Protection)
// ============================================

/**
 * Private IP ranges that should be blocked for SSRF protection.
 */
const PRIVATE_IP_PATTERNS = [
  /^127\./, // Loopback
  /^10\./, // Class A private
  /^172\.(1[6-9]|2[0-9]|3[01])\./, // Class B private
  /^192\.168\./, // Class C private
  /^169\.254\./, // Link-local
  /^0\./, // "This" network
  /^localhost$/i, // Localhost hostname
  /^::1$/, // IPv6 loopback
  /^fc00:/i, // IPv6 private
  /^fe80:/i, // IPv6 link-local
]

/**
 * Reserved/special hostnames that should be blocked.
 */
const BLOCKED_HOSTNAMES = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  'metadata.google.internal', // GCP metadata
  '169.254.169.254', // AWS/GCP/Azure metadata
]

/**
 * Validate a webhook URL for SSRF protection.
 *
 * - Requires HTTPS in production
 * - Blocks private IPs and localhost
 * - Blocks cloud metadata endpoints
 *
 * @param urlString - The URL to validate
 * @returns true if the URL is safe to use
 */
export function isValidWebhookUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString)

    // Must be HTTP(S)
    if (!['http:', 'https:'].includes(url.protocol)) {
      return false
    }

    // Require HTTPS in production
    const isProduction = (process.env.NODE_ENV as string) === 'production'
    if (isProduction && url.protocol !== 'https:') {
      return false
    }

    const hostname = url.hostname.toLowerCase()

    // Block known dangerous hostnames
    if (BLOCKED_HOSTNAMES.includes(hostname)) {
      return false
    }

    // Block private IP ranges
    for (const pattern of PRIVATE_IP_PATTERNS) {
      if (pattern.test(hostname)) {
        return false
      }
    }

    // Block hostnames that look like private IPs in brackets (IPv6)
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      const inner = hostname.slice(1, -1)
      for (const pattern of PRIVATE_IP_PATTERNS) {
        if (pattern.test(inner)) {
          return false
        }
      }
    }

    return true
  } catch {
    return false
  }
}

/**
 * Supported webhook event types.
 */
export const WEBHOOK_EVENTS = ['post.created', 'post.status_changed', 'comment.created'] as const
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number]
