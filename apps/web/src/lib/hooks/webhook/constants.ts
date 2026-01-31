/**
 * Webhook constants and client-safe utilities.
 *
 * This file contains exports that are safe to import in client code.
 * Server-only code (handler with crypto/dns) is in handler.ts.
 */

// ============================================
// Event Types
// ============================================

/**
 * Supported webhook event types.
 */
export const WEBHOOK_EVENTS = [
  'post.created',
  'post.status_changed',
  'post.vote_threshold',
  'comment.created',
] as const
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number]

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
    id: 'post.vote_threshold',
    label: 'Vote Milestone Reached',
    description: 'At 5, 10, 25, 50, 100 votes',
  },
  {
    id: 'comment.created',
    label: 'New Comment',
    description: 'When a comment is posted',
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

// ============================================
// Types (for handler)
// ============================================

import type { WebhookId } from '@quackback/ids'

export interface WebhookTarget {
  url: string
}

export interface WebhookConfig {
  secret: string
  webhookId: WebhookId
}
