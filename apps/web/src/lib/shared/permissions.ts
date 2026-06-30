/**
 * Client-safe mirror of the RBAC permission catalogue.
 *
 * The widget/portal client bundles can't import `@quackback/db` (it drags in
 * postgres), so the catalogue is duplicated here as plain data for the admin UI
 * and `<PermissionGate>`. A drift test (permissions-catalogue-drift.test.ts)
 * asserts this stays identical to the `@quackback/db` source of truth: edit the
 * catalogue there first, then mirror the change here.
 */

export const PERMISSIONS = {
  // workspace
  SETTINGS_MANAGE: 'settings.manage',
  BILLING_MANAGE: 'billing.manage',
  ROLE_MANAGE: 'role.manage',
  API_KEY_MANAGE: 'api_key.manage',
  WEBHOOK_VIEW: 'webhook.view',
  WEBHOOK_MANAGE: 'webhook.manage',
  AUTH_MANAGE: 'auth.manage',
  AUDIT_VIEW: 'audit.view',

  // members
  MEMBER_VIEW: 'member.view',
  MEMBER_MANAGE: 'member.manage',

  // people
  PEOPLE_VIEW: 'people.view',
  PEOPLE_MANAGE: 'people.manage',

  // company
  COMPANY_VIEW: 'company.view',
  COMPANY_MANAGE: 'company.manage',

  // audience
  SEGMENT_VIEW: 'segment.view',
  SEGMENT_MANAGE: 'segment.manage',
  USER_ATTRIBUTE_VIEW: 'user_attribute.view',
  USER_ATTRIBUTE_MANAGE: 'user_attribute.manage',

  // feedback
  POST_VIEW_PRIVATE: 'post.view_private',
  POST_CREATE: 'post.create',
  POST_MODERATE: 'post.moderate',
  POST_APPROVE: 'post.approve',
  POST_VOTE_ON_BEHALF: 'post.vote_on_behalf',
  COMMENT_MODERATE: 'comment.moderate',
  BOARD_MANAGE: 'board.manage',
  ROADMAP_MANAGE: 'roadmap.manage',
  STATUS_VIEW: 'status.view',
  STATUS_MANAGE: 'status.manage',
  TAG_VIEW: 'tag.view',
  TAG_MANAGE: 'tag.manage',
  SUGGESTION_VIEW: 'suggestion.view',
  SUGGESTION_MANAGE: 'suggestion.manage',

  // changelog
  CHANGELOG_VIEW_DRAFT: 'changelog.view_draft',
  CHANGELOG_MANAGE: 'changelog.manage',

  // help_center
  HELP_CENTER_MANAGE: 'help_center.manage',

  // conversation
  CONVERSATION_VIEW: 'conversation.view',
  CONVERSATION_REPLY: 'conversation.reply',
  CONVERSATION_NOTE: 'conversation.note',
  CONVERSATION_ASSIGN: 'conversation.assign',
  CONVERSATION_MANAGE: 'conversation.manage',

  // analytics
  ANALYTICS_VIEW: 'analytics.view',

  // integration
  INTEGRATION_VIEW: 'integration.view',
  INTEGRATION_MANAGE: 'integration.manage',

  // support (dormant until the support platform lands)
  TICKET_VIEW_ALL: 'ticket.view_all',
  TICKET_VIEW_ASSIGNED: 'ticket.view_assigned',
  TICKET_REPLY: 'ticket.reply',
  TICKET_NOTE: 'ticket.note',
  TICKET_ASSIGN: 'ticket.assign',
  SLA_MANAGE: 'sla.manage',
  INBOX_MANAGE: 'inbox.manage',
  ROUTING_MANAGE: 'routing.manage',
  TEAM_MANAGE: 'team.manage',
} as const

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as PermissionKey[]

export const PERMISSION_CATEGORIES = [
  'workspace',
  'members',
  'people',
  'company',
  'audience',
  'feedback',
  'changelog',
  'help_center',
  'conversation',
  'analytics',
  'integration',
  'support',
] as const

export type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number]
