/**
 * Webhook constants and client-safe utilities.
 *
 * This file contains exports that are safe to import in client code.
 * Server-only code (handler with crypto/dns) is in handler.ts.
 */
import type { WebhookId } from '@quackback/ids'
import { EVENT_TYPES, type EventType } from '../../types'

// ============================================
// Event Types
// ============================================

/**
 * Supported webhook event types -- derived from the shared EVENT_TYPES source.
 */
export const WEBHOOK_EVENTS = EVENT_TYPES
export type WebhookEventType = EventType

/**
 * Human-readable labels and descriptions for webhook events.
 * Used in the admin UI for event selection.
 */
export const WEBHOOK_EVENT_CONFIG = [
  {
    id: 'post.created',
    label: 'New Post Created',
    description: 'When a user submits feedback',
  },
  {
    id: 'post.status_changed',
    label: 'Post Status Changed',
    description: 'When a post status is updated',
  },
  {
    id: 'comment.created',
    label: 'New Comment',
    description: 'When a comment is posted',
  },
  {
    id: 'changelog.published',
    label: 'Changelog Published',
    description: 'When a changelog entry is published',
  },
] as const satisfies ReadonlyArray<{ id: WebhookEventType; label: string; description: string }>

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
  /^f[cd]00:/i, // IPv6 unique local (fc00::/7 = fc00::/8 + fd00::/8)
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

    // Must be HTTPS (always required for security)
    if (url.protocol !== 'https:') {
      return false
    }

    const hostname = url.hostname.toLowerCase()

    // Block known dangerous hostnames
    if (BLOCKED_HOSTNAMES.includes(hostname)) {
      return false
    }

    // Block private IP ranges
    const isPrivate = (ip: string): boolean => PRIVATE_IP_PATTERNS.some((p) => p.test(ip))
    if (isPrivate(hostname)) {
      return false
    }

    // Block hostnames that look like private IPs in brackets (IPv6)
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      if (isPrivate(hostname.slice(1, -1))) {
        return false
      }
    }

    return true
  } catch {
    return false
  }
}

// ============================================
// Types (for handler)
// ============================================

export interface WebhookTarget {
  url: string
}

export interface WebhookConfig {
  secret: string
  webhookId: WebhookId
}
