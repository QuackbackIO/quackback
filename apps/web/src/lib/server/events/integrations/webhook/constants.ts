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
    id: 'post.updated',
    label: 'Post Updated',
    description: 'When a post title, content, tags, or owner is changed',
  },
  {
    id: 'post.deleted',
    label: 'Post Deleted',
    description: 'When a post is soft-deleted',
  },
  {
    id: 'post.restored',
    label: 'Post Restored',
    description: 'When a deleted post is restored',
  },
  {
    id: 'post.merged',
    label: 'Post Merged',
    description: 'When a duplicate post is merged into a canonical post',
  },
  {
    id: 'post.unmerged',
    label: 'Post Unmerged',
    description: 'When a merged post is separated back out',
  },
  {
    id: 'comment.created',
    label: 'New Comment',
    description: 'When a comment is posted',
  },
  {
    id: 'comment.updated',
    label: 'Comment Updated',
    description: 'When a comment is edited',
  },
  {
    id: 'comment.deleted',
    label: 'Comment Deleted',
    description: 'When a comment is deleted',
  },
  {
    id: 'changelog.published',
    label: 'Changelog Published',
    description: 'When a changelog entry is published',
  },
  {
    id: 'conversation.created',
    label: 'Conversation Created',
    description: 'When a visitor starts a new conversation',
  },
  {
    id: 'conversation.status_changed',
    label: 'Conversation Status Changed',
    description: 'When a conversation moves between open, pending, and closed',
  },
  {
    id: 'conversation.assigned',
    label: 'Conversation Assigned',
    description: 'When a conversation is assigned to (or unassigned from) an agent',
  },
  {
    id: 'conversation.priority_changed',
    label: 'Conversation Priority Changed',
    description: 'When a conversation priority is changed',
  },
  {
    id: 'conversation.attribute_changed',
    label: 'Conversation Attribute Changed',
    description: 'When a conversation attribute is set or cleared by AI, a teammate, or a customer',
  },
  {
    id: 'conversation.csat_submitted',
    label: 'CSAT Submitted',
    description: 'When a visitor submits a satisfaction rating',
  },
  {
    id: 'conversation.csat_comment_added',
    label: 'CSAT Comment Added',
    description: 'When a visitor adds the optional comment to a satisfaction rating',
  },
  {
    id: 'assistant.handed_off',
    label: 'Assistant Handed Off',
    description: 'When the AI assistant hands a conversation to the team',
  },
  {
    id: 'conversation.note_mentioned',
    label: 'Note Mention',
    description: 'When an internal note @-mentions a teammate (private content — opt-in)',
  },
  {
    id: 'conversation.customer_unresponsive',
    label: 'Customer Unresponsive',
    description:
      'When the customer has been silent for a workflow-configured time after the last teammate or AI reply',
  },
  {
    id: 'conversation.teammate_unresponsive',
    label: 'Teammate Unresponsive',
    description:
      "When no teammate has replied for a workflow-configured time after the customer's last message",
  },
  {
    id: 'sla.approaching_breach',
    label: 'SLA Approaching Breach',
    description: 'When an applied SLA clock enters its lead-time warning window',
  },
  {
    id: 'sla.breached',
    label: 'SLA Breached',
    description: 'When an applied SLA clock passes its due date unsettled',
  },
  {
    id: 'message.created',
    label: 'New Message',
    description: 'When a visitor or agent sends a public message',
  },
  {
    id: 'message.note_created',
    label: 'Internal Note Added',
    description: 'When an agent adds an internal note (private content — opt-in)',
  },
  {
    id: 'message.deleted',
    label: 'Message Deleted',
    description: 'When a public message is deleted',
  },
  {
    id: 'ticket.created',
    label: 'Ticket Created',
    description: 'When a ticket is opened',
  },
  {
    id: 'ticket.status_changed',
    label: 'Ticket Status Changed',
    description: 'When a ticket moves between open, pending, and closed',
  },
  {
    id: 'ticket.assigned',
    label: 'Ticket Assigned',
    description: 'When a ticket is assigned to (or unassigned from) an agent or team',
  },
  {
    id: 'ticket.replied',
    label: 'Ticket Reply',
    description: 'When an agent or the requester replies on a ticket thread',
  },
  {
    id: 'ticket.note_added',
    label: 'Ticket Internal Note',
    description: 'When an agent adds an internal note to a ticket (private content — opt-in)',
  },
  {
    id: 'ticket.external_status_changed',
    label: 'Linked Issue Status Changed',
    description: 'When a tracker issue linked to a ticket changes status on the external platform',
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
  // The signing secret is not carried in the enqueued job payload; it is loaded
  // and decrypted by webhook id at delivery time so it never rests in the queue.
  webhookId: WebhookId
}
