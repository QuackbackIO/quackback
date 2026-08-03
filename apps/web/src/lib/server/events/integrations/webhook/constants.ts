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
 * Categories used to group webhook events in the admin UI picker.
 * The order here drives the rendered section order.
 */
export const WEBHOOK_EVENT_CATEGORIES = [
  { id: 'posts', label: 'Posts' },
  { id: 'comments', label: 'Comments' },
  { id: 'changelog', label: 'Changelog' },
  { id: 'tickets', label: 'Tickets' },
  { id: 'configuration', label: 'Configuration' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'organizations', label: 'Organizations' },
  { id: 'conversations', label: 'Conversations' },
  { id: 'help_center', label: 'Help Center' },
  { id: 'audience', label: 'Audience' },
  { id: 'feedback_config', label: 'Feedback Configuration' },
  { id: 'admin', label: 'Administration' },
] as const satisfies ReadonlyArray<{ id: string; label: string }>

export type WebhookEventCategory = (typeof WEBHOOK_EVENT_CATEGORIES)[number]['id']

/**
 * Human-readable labels and descriptions for webhook events.
 * Used in the admin UI for event selection.
 */
export const WEBHOOK_EVENT_CONFIG = [
  {
    id: 'post.created',
    label: 'New Post Created',
    description: 'When a user submits feedback',
    category: 'posts',
  },
  {
    id: 'post.status_changed',
    label: 'Post Status Changed',
    description: 'When a post status is updated',
    category: 'posts',
  },
  {
    id: 'post.updated',
    label: 'Post Updated',
    description: 'When a post title, content, tags, or owner is changed',
    category: 'posts',
  },
  {
    id: 'post.deleted',
    label: 'Post Deleted',
    description: 'When a post is soft-deleted',
    category: 'posts',
  },
  {
    id: 'post.restored',
    label: 'Post Restored',
    description: 'When a deleted post is restored',
    category: 'posts',
  },
  {
    id: 'post.merged',
    label: 'Post Merged',
    description: 'When a duplicate post is merged into a canonical post',
    category: 'posts',
  },
  {
    id: 'post.unmerged',
    label: 'Post Unmerged',
    description: 'When a merged post is separated back out',
    category: 'posts',
  },
  {
    id: 'post.mentioned',
    label: 'Post Mention',
    description: 'When a principal is mentioned in a post body',
    category: 'posts',
  },
  {
    id: 'comment.created',
    label: 'New Comment',
    description: 'When a comment is posted',
    category: 'comments',
  },
  {
    id: 'comment.updated',
    label: 'Comment Updated',
    description: 'When a comment is edited',
    category: 'comments',
  },
  {
    id: 'comment.deleted',
    label: 'Comment Deleted',
    description: 'When a comment is deleted',
    category: 'comments',
  },
  {
    id: 'changelog.published',
    label: 'Changelog Published',
    description: 'When a changelog entry is published',
    category: 'changelog',
  },
  {
    id: 'changelog.created',
    label: 'Changelog Created',
    description: 'When a changelog entry is created (draft, scheduled, or published)',
    category: 'changelog',
  },
  {
    id: 'changelog.updated',
    label: 'Changelog Updated',
    description: "When a changelog entry's title, content, category, or product is changed",
    category: 'changelog',
  },
  {
    id: 'changelog.deleted',
    label: 'Changelog Deleted',
    description: 'When a changelog entry is soft-deleted',
    category: 'changelog',
  },
  {
    id: 'ticket.created',
    label: 'Ticket Created',
    description: 'When a new support ticket is opened (portal, email, API, or widget)',
    category: 'tickets',
  },
  {
    id: 'ticket.updated',
    label: 'Ticket Updated',
    description:
      "When a ticket's subject, priority, team, visibility, inbox, organization, or requester is changed",
    category: 'tickets',
  },
  {
    id: 'ticket.deleted',
    label: 'Ticket Deleted',
    description: 'When a ticket is soft-deleted by an agent',
    category: 'tickets',
  },
  {
    id: 'ticket.restored',
    label: 'Ticket Restored',
    description: 'When a soft-deleted ticket is restored',
    category: 'tickets',
  },
  {
    id: 'ticket.assigned',
    label: 'Ticket Assigned',
    description: 'When a ticket is assigned to an agent or team',
    category: 'tickets',
  },
  {
    id: 'ticket.unassigned',
    label: 'Ticket Unassigned',
    description: "When a ticket's assignee is cleared",
    category: 'tickets',
  },
  {
    id: 'ticket.status_changed',
    label: 'Ticket Status Changed',
    description: 'When a ticket moves to a new status (e.g. open → solved)',
    category: 'tickets',
  },
  {
    id: 'ticket.first_response',
    label: 'Ticket First Response',
    description:
      'When the first public agent reply on a ticket is recorded (the SLA first-response clock stops)',
    category: 'tickets',
  },
  {
    id: 'ticket.thread_added',
    label: 'Ticket Reply Added',
    description:
      'When a public reply is added to a ticket. Internal and shared-team notes are never delivered.',
    category: 'tickets',
  },
  {
    id: 'ticket.thread_updated',
    label: 'Ticket Reply Updated',
    description:
      'When a public ticket reply is edited. Internal and shared-team notes are never delivered.',
    category: 'tickets',
  },
  {
    id: 'ticket.thread_deleted',
    label: 'Ticket Reply Deleted',
    description:
      'When a public ticket reply is deleted. Internal and shared-team notes are never delivered.',
    category: 'tickets',
  },
  {
    id: 'ticket.participant_added',
    label: 'Ticket Participant Added',
    description: 'When a watcher, collaborator, or CC is added to a ticket',
    category: 'tickets',
  },
  {
    id: 'ticket.participant_removed',
    label: 'Ticket Participant Removed',
    description: 'When a participant is removed from a ticket',
    category: 'tickets',
  },
  {
    id: 'ticket.shared',
    label: 'Ticket Shared',
    description: 'When a ticket is shared with another team',
    category: 'tickets',
  },
  {
    id: 'ticket.unshared',
    label: 'Ticket Unshared',
    description: 'When a ticket share is revoked',
    category: 'tickets',
  },
  {
    id: 'ticket.sla_warning',
    label: 'SLA Warning',
    description: 'When a ticket is approaching an SLA deadline (escalation rule fired)',
    category: 'tickets',
  },
  {
    id: 'ticket.sla_breach',
    label: 'SLA Breach',
    description: 'When a ticket misses an SLA target',
    category: 'tickets',
  },
  {
    id: 'ticket.attachment_added',
    label: 'Ticket Attachment Added',
    description: 'When a file is attached to a ticket thread',
    category: 'tickets',
  },
  {
    id: 'ticket.attachment_removed',
    label: 'Ticket Attachment Removed',
    description: 'When a ticket attachment is deleted',
    category: 'tickets',
  },
  // Configuration plane (Phase 6)
  {
    id: 'inbox.created',
    label: 'Inbox Created',
    description: 'When a new inbox is added to the workspace',
    category: 'configuration',
  },
  {
    id: 'inbox.updated',
    label: 'Inbox Updated',
    description: 'When inbox settings change (name, defaults, primary team)',
    category: 'configuration',
  },
  {
    id: 'inbox.archived',
    label: 'Inbox Archived',
    description: 'When an inbox is archived (hidden from active queues)',
    category: 'configuration',
  },
  {
    id: 'inbox.unarchived',
    label: 'Inbox Unarchived',
    description: 'When an archived inbox is restored',
    category: 'configuration',
  },
  {
    id: 'team.created',
    label: 'Team Created',
    description: 'When a new team is added to the workspace',
    category: 'configuration',
  },
  {
    id: 'team.updated',
    label: 'Team Updated',
    description: 'When team settings change (name, color, archived state)',
    category: 'configuration',
  },
  {
    id: 'team.archived',
    label: 'Team Archived',
    description: 'When a team is archived',
    category: 'configuration',
  },
  {
    id: 'ticket_status.created',
    label: 'Ticket Status Created',
    description: 'When a new workflow status is added',
    category: 'configuration',
  },
  {
    id: 'ticket_status.updated',
    label: 'Ticket Status Updated',
    description: 'When a workflow status is renamed, recategorized, or archived',
    category: 'configuration',
  },
  {
    id: 'contact.created',
    label: 'Contact Created',
    description: 'When a CRM contact is added (UI, REST, or ticket intake)',
    category: 'contacts',
  },
  {
    id: 'contact.updated',
    label: 'Contact Updated',
    description: "When a contact's name, email, organization, or other fields change",
    category: 'contacts',
  },
  {
    id: 'contact.archived',
    label: 'Contact Archived',
    description: 'When a contact is soft-deleted',
    category: 'contacts',
  },
  {
    id: 'contact.linked',
    label: 'Contact Linked to User',
    description: 'When a contact is linked to a portal user account',
    category: 'contacts',
  },
  {
    id: 'contact.unlinked',
    label: 'Contact Unlinked from User',
    description: 'When a contact is unlinked from a portal user account',
    category: 'contacts',
  },
  {
    id: 'organization.created',
    label: 'Organization Created',
    description: 'When a CRM organization is added (UI, REST, or ticket intake by domain)',
    category: 'organizations',
  },
  {
    id: 'organization.updated',
    label: 'Organization Updated',
    description: "When an organization's name, domain, website, or other fields change",
    category: 'organizations',
  },
  {
    id: 'organization.archived',
    label: 'Organization Archived',
    description: 'When an organization is archived',
    category: 'organizations',
  },
  {
    id: 'organization.unarchived',
    label: 'Organization Unarchived',
    description: 'When an archived organization is restored',
    category: 'organizations',
  },
  {
    id: 'conversation.created',
    label: 'Conversation Created',
    description: 'When a visitor starts a new conversation',
    category: 'conversations',
  },
  {
    id: 'conversation.status_changed',
    label: 'Conversation Status Changed',
    description: 'When a conversation moves between open, pending, and closed',
    category: 'conversations',
  },
  {
    id: 'conversation.assigned',
    label: 'Conversation Assigned',
    description: 'When a conversation is assigned to (or unassigned from) an agent',
    category: 'conversations',
  },
  {
    id: 'conversation.priority_changed',
    label: 'Conversation Priority Changed',
    description: 'When a conversation priority is changed',
    category: 'conversations',
  },
  {
    id: 'conversation.csat_submitted',
    label: 'CSAT Submitted',
    description: 'When a visitor submits a satisfaction rating',
    category: 'conversations',
  },
  {
    id: 'conversation.csat_comment_added',
    label: 'CSAT Comment Added',
    description: 'When a visitor adds the optional comment to a satisfaction rating',
    category: 'conversations',
  },
  {
    id: 'message.created',
    label: 'New Message',
    description: 'When a visitor or agent sends a public message',
    category: 'conversations',
  },
  {
    id: 'message.note_created',
    label: 'Internal Note Added',
    description: 'When an agent adds an internal note (private content — opt-in)',
    category: 'conversations',
  },
  {
    id: 'message.deleted',
    label: 'Message Deleted',
    description: 'When a public message is deleted',
    category: 'conversations',
  },
  // Help Center (Phase 2)
  {
    id: 'help_center.category.created',
    label: 'Help Center Category Created',
    description: 'When a new help-center category is added',
    category: 'help_center',
  },
  {
    id: 'help_center.category.updated',
    label: 'Help Center Category Updated',
    description: "When a category's name, slug, parent, visibility, or position changes",
    category: 'help_center',
  },
  {
    id: 'help_center.category.deleted',
    label: 'Help Center Category Deleted',
    description: 'When a help-center category is soft-deleted',
    category: 'help_center',
  },
  {
    id: 'help_center.article.created',
    label: 'Help Center Article Created',
    description: 'When a new help-center article is created',
    category: 'help_center',
  },
  {
    id: 'help_center.article.updated',
    label: 'Help Center Article Updated',
    description: "When an article's title, content, category, or slug changes",
    category: 'help_center',
  },
  {
    id: 'help_center.article.published',
    label: 'Help Center Article Published',
    description: 'When a help-center article is published',
    category: 'help_center',
  },
  {
    id: 'help_center.article.unpublished',
    label: 'Help Center Article Unpublished',
    description: 'When a published help-center article is reverted to draft',
    category: 'help_center',
  },
  {
    id: 'help_center.article.deleted',
    label: 'Help Center Article Deleted',
    description: 'When a help-center article is soft-deleted',
    category: 'help_center',
  },
  // Audience (Phase 2)
  {
    id: 'segment.created',
    label: 'Segment Created',
    description: 'When a new audience segment is created (manual or dynamic)',
    category: 'audience',
  },
  {
    id: 'segment.updated',
    label: 'Segment Updated',
    description: "When a segment's name, rules, color, or schedule changes",
    category: 'audience',
  },
  {
    id: 'segment.deleted',
    label: 'Segment Deleted',
    description: 'When an audience segment is soft-deleted',
    category: 'audience',
  },
  {
    id: 'user_attribute.created',
    label: 'User Attribute Created',
    description: 'When a new user-attribute definition is added',
    category: 'audience',
  },
  {
    id: 'user_attribute.updated',
    label: 'User Attribute Updated',
    description: "When a user-attribute definition's label, type, or mapping changes",
    category: 'audience',
  },
  {
    id: 'user_attribute.deleted',
    label: 'User Attribute Deleted',
    description: 'When a user-attribute definition is deleted',
    category: 'audience',
  },
  // Feedback configuration (boards, tags, post statuses, roadmaps)
  {
    id: 'board.created',
    label: 'Board Created',
    description: 'When a feedback board is created',
    category: 'feedback_config',
  },
  {
    id: 'board.updated',
    label: 'Board Updated',
    description: 'When a feedback board is updated',
    category: 'feedback_config',
  },
  {
    id: 'board.deleted',
    label: 'Board Deleted',
    description: 'When a feedback board is deleted',
    category: 'feedback_config',
  },
  {
    id: 'tag.created',
    label: 'Tag Created',
    description: 'When a post tag is created',
    category: 'feedback_config',
  },
  {
    id: 'tag.updated',
    label: 'Tag Updated',
    description: 'When a post tag is updated',
    category: 'feedback_config',
  },
  {
    id: 'tag.deleted',
    label: 'Tag Deleted',
    description: 'When a post tag is deleted',
    category: 'feedback_config',
  },
  {
    id: 'status.created',
    label: 'Status Created',
    description: 'When a post status is created',
    category: 'feedback_config',
  },
  {
    id: 'status.updated',
    label: 'Status Updated',
    description: 'When a post status is updated',
    category: 'feedback_config',
  },
  {
    id: 'status.deleted',
    label: 'Status Deleted',
    description: 'When a post status is deleted',
    category: 'feedback_config',
  },
  {
    id: 'roadmap.created',
    label: 'Roadmap Created',
    description: 'When a roadmap is created',
    category: 'feedback_config',
  },
  {
    id: 'roadmap.updated',
    label: 'Roadmap Updated',
    description: 'When a roadmap is updated',
    category: 'feedback_config',
  },
  {
    id: 'roadmap.deleted',
    label: 'Roadmap Deleted',
    description: 'When a roadmap is deleted',
    category: 'feedback_config',
  },
  // Support configuration (SLA, routing, business hours, inbox channels/memberships)
  {
    id: 'sla_policy.created',
    label: 'SLA Policy Created',
    description: 'When an SLA policy is created',
    category: 'configuration',
  },
  {
    id: 'sla_policy.updated',
    label: 'SLA Policy Updated',
    description: 'When an SLA policy is updated',
    category: 'configuration',
  },
  {
    id: 'sla_policy.archived',
    label: 'SLA Policy Archived',
    description: 'When an SLA policy is archived',
    category: 'configuration',
  },
  {
    id: 'routing_rule.created',
    label: 'Routing Rule Created',
    description: 'When a routing rule is created',
    category: 'configuration',
  },
  {
    id: 'routing_rule.updated',
    label: 'Routing Rule Updated',
    description: 'When a routing rule is updated',
    category: 'configuration',
  },
  {
    id: 'routing_rule.deleted',
    label: 'Routing Rule Deleted',
    description: 'When a routing rule is deleted',
    category: 'configuration',
  },
  {
    id: 'business_hours.created',
    label: 'Business Hours Created',
    description: 'When a business-hours calendar is created',
    category: 'configuration',
  },
  {
    id: 'business_hours.updated',
    label: 'Business Hours Updated',
    description: 'When a business-hours calendar is updated',
    category: 'configuration',
  },
  {
    id: 'business_hours.archived',
    label: 'Business Hours Archived',
    description: 'When a business-hours calendar is archived',
    category: 'configuration',
  },
  {
    id: 'inbox_channel.created',
    label: 'Inbox Channel Created',
    description: 'When an inbox channel is added',
    category: 'configuration',
  },
  {
    id: 'inbox_channel.updated',
    label: 'Inbox Channel Updated',
    description: 'When an inbox channel is updated',
    category: 'configuration',
  },
  {
    id: 'inbox_channel.archived',
    label: 'Inbox Channel Archived',
    description: 'When an inbox channel is archived',
    category: 'configuration',
  },
  {
    id: 'inbox_membership.added',
    label: 'Inbox Member Added',
    description: 'When a principal is added to an inbox',
    category: 'configuration',
  },
  {
    id: 'inbox_membership.updated',
    label: 'Inbox Member Updated',
    description: "When an inbox member's role changes",
    category: 'configuration',
  },
  {
    id: 'inbox_membership.removed',
    label: 'Inbox Member Removed',
    description: 'When a principal is removed from an inbox',
    category: 'configuration',
  },
  // Administration (API keys, roles, role assignments)
  {
    id: 'api_key.created',
    label: 'API Key Created',
    description: 'When an API key is created',
    category: 'admin',
  },
  {
    id: 'api_key.rotated',
    label: 'API Key Rotated',
    description: 'When an API key secret is rotated',
    category: 'admin',
  },
  {
    id: 'api_key.revoked',
    label: 'API Key Revoked',
    description: 'When an API key is revoked',
    category: 'admin',
  },
  {
    id: 'role.created',
    label: 'Role Created',
    description: 'When a custom role is created',
    category: 'admin',
  },
  {
    id: 'role.updated',
    label: 'Role Updated',
    description: 'When a role is updated',
    category: 'admin',
  },
  {
    id: 'role.deleted',
    label: 'Role Deleted',
    description: 'When a custom role is deleted',
    category: 'admin',
  },
  {
    id: 'role_assignment.created',
    label: 'Role Assigned',
    description: 'When a role is assigned to a principal',
    category: 'admin',
  },
  {
    id: 'role_assignment.revoked',
    label: 'Role Revoked',
    description: 'When a role assignment is revoked',
    category: 'admin',
  },
] as const satisfies ReadonlyArray<{
  id: WebhookEventType
  label: string
  description: string
  category: WebhookEventCategory
}>

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
