/**
 * Client-safe mirror of the RBAC permission catalogue.
 *
 * The widget/portal client bundles can't import `@quackback/db` (it drags in
 * postgres), so the catalogue is duplicated here as plain data for the admin
 * UI. A drift test (permissions-catalogue-drift.test.ts) asserts this stays
 * identical to the `@quackback/db` source of truth: edit the catalogue there
 * first, then mirror the change here.
 */

export const PERMISSIONS = {
  // workspace
  SETTINGS_MANAGE: 'settings.manage',
  SETTINGS_BRANDING: 'settings.branding',
  SETTINGS_MODERATION: 'settings.moderation',
  SETTINGS_NOTIFICATIONS: 'settings.notifications',
  SETTINGS_CUSTOM_DOMAIN: 'settings.custom_domain',
  BILLING_MANAGE: 'billing.manage',
  ROLE_MANAGE: 'role.manage',
  API_KEY_MANAGE: 'api_key.manage',
  WEBHOOK_VIEW: 'webhook.view',
  WEBHOOK_MANAGE: 'webhook.manage',
  AUTH_MANAGE: 'auth.manage',
  AUDIT_VIEW: 'audit.view',
  CUSTOM_FIELD_MANAGE: 'custom_field.manage',

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
  POST_EDIT: 'post.edit',
  POST_DELETE: 'post.delete',
  POST_SET_STATUS: 'post.set_status',
  POST_SET_BOARD: 'post.set_board',
  POST_SET_TAGS: 'post.set_tags',
  POST_SET_OWNER: 'post.set_owner',
  POST_SET_AUTHOR: 'post.set_author',
  POST_MERGE: 'post.merge',
  POST_EXPORT: 'post.export',
  POST_SET_PINNED: 'post.set_pinned',
  POST_SET_ETA: 'post.set_eta',
  POST_APPROVE: 'post.approve',
  POST_VOTE_ON_BEHALF: 'post.vote_on_behalf',
  COMMENT_MODERATE: 'comment.moderate',
  COMMENT_EDIT: 'comment.edit',
  COMMENT_PIN: 'comment.pin',
  COMMENT_VIEW_PRIVATE: 'comment.view_private',
  BOARD_MANAGE: 'board.manage',
  ROADMAP_MANAGE: 'roadmap.manage',
  STATUS_VIEW: 'status.view',
  STATUS_MANAGE: 'status.manage',
  TAG_VIEW: 'tag.view',
  TAG_MANAGE: 'tag.manage',
  SUGGESTION_VIEW: 'suggestion.view',
  SUGGESTION_MANAGE: 'suggestion.manage',
  PRIORITIZATION_MANAGE: 'prioritization.manage',

  // changelog
  CHANGELOG_VIEW_DRAFT: 'changelog.view_draft',
  CHANGELOG_MANAGE: 'changelog.manage',

  // help_center
  HELP_CENTER_MANAGE: 'help_center.manage',

  // survey
  SURVEY_VIEW: 'survey.view',
  SURVEY_MANAGE: 'survey.manage',

  // conversation
  CONVERSATION_VIEW: 'conversation.view',
  CONVERSATION_VIEW_ALL: 'conversation.view_all',
  CONVERSATION_REPLY: 'conversation.reply',
  CONVERSATION_NOTE: 'conversation.note',
  CONVERSATION_ASSIGN: 'conversation.assign',
  CONVERSATION_MANAGE: 'conversation.manage',
  CONVERSATION_SET_STATUS: 'conversation.set_status',
  CONVERSATION_SET_TAGS: 'conversation.set_tags',
  CONVERSATION_MANAGE_TAGS: 'conversation.manage_tags',
  CONVERSATION_MANAGE_VIEWS: 'conversation.manage_views',
  CONVERSATION_SET_ATTRIBUTES: 'conversation.set_attributes',

  // analytics
  ANALYTICS_VIEW: 'analytics.view',

  // integration
  INTEGRATION_VIEW: 'integration.view',
  INTEGRATION_MANAGE: 'integration.manage',

  // support (dormant until the support platform lands). Tickets are a peer aggregate with their own
  // resource verbs, team-scoped for humans and workspace-scoped for machine/AI principals.
  TICKET_VIEW: 'ticket.view',
  TICKET_VIEW_ALL: 'ticket.view_all',
  TICKET_REPLY: 'ticket.reply',
  TICKET_NOTE: 'ticket.note',
  TICKET_ASSIGN: 'ticket.assign',
  TICKET_SET_STATUS: 'ticket.set_status',
  TICKET_CREATE: 'ticket.create',
  TICKET_MANAGE_TYPES: 'ticket.manage_types',
  SLA_MANAGE: 'sla.manage',
  ROUTING_MANAGE: 'routing.manage',
  TEAM_MANAGE: 'team.manage',
  WORKFLOW_MANAGE: 'workflow.manage',
  CHANNEL_ACCOUNT_MANAGE: 'channel_account.manage',

  // ai
  ASSISTANT_MANAGE: 'assistant.manage',
  CONNECTOR_MANAGE: 'connector.manage',
  COPILOT_USE: 'copilot.use',

  // status_page (named status_page.* to avoid colliding with the existing
  // post-status-taxonomy STATUS_VIEW/STATUS_MANAGE keys above)
  STATUS_PAGE_MANAGE: 'status_page.manage',
  STATUS_PAGE_PUBLISH: 'status_page.publish',
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
  'survey',
  'conversation',
  'analytics',
  'integration',
  'support',
  'ai',
  'status_page',
] as const

export type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number]

// --------------------------------------------------------------- presets ---
// Mirrored from @quackback/db (the drift test enforces equality). The policy
// layer resolves an actor's permissions from these, and the read-only Roles UI
// renders them, so they must be client-safe.

export const SYSTEM_ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MANAGER: 'manager',
  CONTRIBUTOR: 'contributor',
} as const

export type SystemRoleKey = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES]

export const WORKSPACE_ADMIN_PERMISSIONS: readonly PermissionKey[] = [
  PERMISSIONS.SETTINGS_MANAGE,
  PERMISSIONS.SETTINGS_BRANDING,
  PERMISSIONS.SETTINGS_MODERATION,
  PERMISSIONS.SETTINGS_NOTIFICATIONS,
  PERMISSIONS.SETTINGS_CUSTOM_DOMAIN,
  PERMISSIONS.BILLING_MANAGE,
  PERMISSIONS.MEMBER_MANAGE,
  PERMISSIONS.ROLE_MANAGE,
  PERMISSIONS.API_KEY_MANAGE,
  PERMISSIONS.WEBHOOK_VIEW,
  PERMISSIONS.WEBHOOK_MANAGE,
  PERMISSIONS.AUTH_MANAGE,
  PERMISSIONS.INTEGRATION_MANAGE,
  PERMISSIONS.AUDIT_VIEW,
  PERMISSIONS.CUSTOM_FIELD_MANAGE,
  PERMISSIONS.SLA_MANAGE,
  PERMISSIONS.ROUTING_MANAGE,
  PERMISSIONS.TEAM_MANAGE,
  PERMISSIONS.WORKFLOW_MANAGE,
  PERMISSIONS.CHANNEL_ACCOUNT_MANAGE,
  PERMISSIONS.ASSISTANT_MANAGE,
  PERMISSIONS.CONNECTOR_MANAGE,
  PERMISSIONS.STATUS_PAGE_MANAGE,
]

export const SYSTEM_ROLE_PERMISSIONS: Record<SystemRoleKey, PermissionKey[]> = {
  owner: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS.filter((p) => p !== PERMISSIONS.BILLING_MANAGE),
  manager: ALL_PERMISSIONS.filter((p) => !WORKSPACE_ADMIN_PERMISSIONS.includes(p)),
  contributor: [
    PERMISSIONS.POST_VIEW_PRIVATE,
    PERMISSIONS.POST_CREATE,
    PERMISSIONS.POST_SET_STATUS,
    PERMISSIONS.POST_SET_BOARD,
    PERMISSIONS.POST_SET_TAGS,
    PERMISSIONS.POST_SET_OWNER,
    PERMISSIONS.POST_MERGE,
    PERMISSIONS.POST_APPROVE,
    PERMISSIONS.POST_VOTE_ON_BEHALF,
    PERMISSIONS.COMMENT_MODERATE,
    PERMISSIONS.COMMENT_PIN,
    PERMISSIONS.CONVERSATION_VIEW,
    PERMISSIONS.CONVERSATION_REPLY,
    PERMISSIONS.CONVERSATION_NOTE,
    PERMISSIONS.CONVERSATION_ASSIGN,
    PERMISSIONS.CONVERSATION_SET_STATUS,
    PERMISSIONS.CONVERSATION_SET_TAGS,
    PERMISSIONS.COPILOT_USE,
    PERMISSIONS.CHANGELOG_VIEW_DRAFT,
    PERMISSIONS.PEOPLE_VIEW,
    PERMISSIONS.COMPANY_VIEW,
    PERMISSIONS.MEMBER_VIEW,
    PERMISSIONS.SEGMENT_VIEW,
    PERMISSIONS.INTEGRATION_VIEW,
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.STATUS_VIEW,
    PERMISSIONS.TAG_VIEW,
    PERMISSIONS.SUGGESTION_VIEW,
    PERMISSIONS.SUGGESTION_MANAGE,
    PERMISSIONS.STATUS_PAGE_PUBLISH,
  ],
}

/** Legacy `principal.role` -> system role preset (admin -> Owner, member ->
 *  Manager, everything else -> none). */
export function presetForLegacyRole(role: string): SystemRoleKey | null {
  if (role === 'admin') return SYSTEM_ROLES.OWNER
  if (role === 'member') return SYSTEM_ROLES.MANAGER
  return null
}

/**
 * Each permission's category, for the read-only Roles matrix UI. The
 * (key, category) pairs mirror @quackback/db's PERMISSION_CATALOGUE; the drift
 * test enforces the projection. Descriptions live only in the db catalogue.
 */
export const PERMISSION_CATALOGUE: ReadonlyArray<{
  key: PermissionKey
  category: PermissionCategory
}> = [
  { key: PERMISSIONS.SETTINGS_MANAGE, category: 'workspace' },
  { key: PERMISSIONS.BILLING_MANAGE, category: 'workspace' },
  { key: PERMISSIONS.ROLE_MANAGE, category: 'workspace' },
  { key: PERMISSIONS.API_KEY_MANAGE, category: 'workspace' },
  { key: PERMISSIONS.WEBHOOK_VIEW, category: 'workspace' },
  { key: PERMISSIONS.WEBHOOK_MANAGE, category: 'workspace' },
  { key: PERMISSIONS.AUTH_MANAGE, category: 'workspace' },
  { key: PERMISSIONS.AUDIT_VIEW, category: 'workspace' },
  { key: PERMISSIONS.SETTINGS_BRANDING, category: 'workspace' },
  { key: PERMISSIONS.SETTINGS_MODERATION, category: 'workspace' },
  { key: PERMISSIONS.SETTINGS_NOTIFICATIONS, category: 'workspace' },
  { key: PERMISSIONS.SETTINGS_CUSTOM_DOMAIN, category: 'workspace' },
  { key: PERMISSIONS.CUSTOM_FIELD_MANAGE, category: 'workspace' },
  { key: PERMISSIONS.MEMBER_VIEW, category: 'members' },
  { key: PERMISSIONS.MEMBER_MANAGE, category: 'members' },
  { key: PERMISSIONS.PEOPLE_VIEW, category: 'people' },
  { key: PERMISSIONS.PEOPLE_MANAGE, category: 'people' },
  { key: PERMISSIONS.COMPANY_VIEW, category: 'company' },
  { key: PERMISSIONS.COMPANY_MANAGE, category: 'company' },
  { key: PERMISSIONS.SEGMENT_VIEW, category: 'audience' },
  { key: PERMISSIONS.SEGMENT_MANAGE, category: 'audience' },
  { key: PERMISSIONS.USER_ATTRIBUTE_VIEW, category: 'audience' },
  { key: PERMISSIONS.USER_ATTRIBUTE_MANAGE, category: 'audience' },
  { key: PERMISSIONS.POST_VIEW_PRIVATE, category: 'feedback' },
  { key: PERMISSIONS.POST_CREATE, category: 'feedback' },
  { key: PERMISSIONS.POST_EDIT, category: 'feedback' },
  { key: PERMISSIONS.POST_DELETE, category: 'feedback' },
  { key: PERMISSIONS.POST_SET_STATUS, category: 'feedback' },
  { key: PERMISSIONS.POST_SET_BOARD, category: 'feedback' },
  { key: PERMISSIONS.POST_SET_TAGS, category: 'feedback' },
  { key: PERMISSIONS.POST_SET_OWNER, category: 'feedback' },
  { key: PERMISSIONS.POST_SET_AUTHOR, category: 'feedback' },
  { key: PERMISSIONS.POST_MERGE, category: 'feedback' },
  { key: PERMISSIONS.POST_EXPORT, category: 'feedback' },
  { key: PERMISSIONS.POST_SET_PINNED, category: 'feedback' },
  { key: PERMISSIONS.POST_SET_ETA, category: 'feedback' },
  { key: PERMISSIONS.POST_APPROVE, category: 'feedback' },
  { key: PERMISSIONS.POST_VOTE_ON_BEHALF, category: 'feedback' },
  { key: PERMISSIONS.COMMENT_MODERATE, category: 'feedback' },
  { key: PERMISSIONS.COMMENT_EDIT, category: 'feedback' },
  { key: PERMISSIONS.COMMENT_PIN, category: 'feedback' },
  { key: PERMISSIONS.COMMENT_VIEW_PRIVATE, category: 'feedback' },
  { key: PERMISSIONS.BOARD_MANAGE, category: 'feedback' },
  { key: PERMISSIONS.ROADMAP_MANAGE, category: 'feedback' },
  { key: PERMISSIONS.STATUS_VIEW, category: 'feedback' },
  { key: PERMISSIONS.STATUS_MANAGE, category: 'feedback' },
  { key: PERMISSIONS.TAG_VIEW, category: 'feedback' },
  { key: PERMISSIONS.TAG_MANAGE, category: 'feedback' },
  { key: PERMISSIONS.SUGGESTION_VIEW, category: 'feedback' },
  { key: PERMISSIONS.SUGGESTION_MANAGE, category: 'feedback' },
  { key: PERMISSIONS.PRIORITIZATION_MANAGE, category: 'feedback' },
  { key: PERMISSIONS.CHANGELOG_VIEW_DRAFT, category: 'changelog' },
  { key: PERMISSIONS.CHANGELOG_MANAGE, category: 'changelog' },
  { key: PERMISSIONS.HELP_CENTER_MANAGE, category: 'help_center' },
  { key: PERMISSIONS.SURVEY_VIEW, category: 'survey' },
  { key: PERMISSIONS.SURVEY_MANAGE, category: 'survey' },
  { key: PERMISSIONS.CONVERSATION_VIEW, category: 'conversation' },
  { key: PERMISSIONS.CONVERSATION_VIEW_ALL, category: 'conversation' },
  { key: PERMISSIONS.CONVERSATION_REPLY, category: 'conversation' },
  { key: PERMISSIONS.CONVERSATION_NOTE, category: 'conversation' },
  { key: PERMISSIONS.CONVERSATION_ASSIGN, category: 'conversation' },
  { key: PERMISSIONS.CONVERSATION_MANAGE, category: 'conversation' },
  { key: PERMISSIONS.CONVERSATION_SET_STATUS, category: 'conversation' },
  { key: PERMISSIONS.CONVERSATION_SET_TAGS, category: 'conversation' },
  { key: PERMISSIONS.CONVERSATION_MANAGE_TAGS, category: 'conversation' },
  { key: PERMISSIONS.CONVERSATION_MANAGE_VIEWS, category: 'conversation' },
  { key: PERMISSIONS.CONVERSATION_SET_ATTRIBUTES, category: 'conversation' },
  { key: PERMISSIONS.ANALYTICS_VIEW, category: 'analytics' },
  { key: PERMISSIONS.INTEGRATION_VIEW, category: 'integration' },
  { key: PERMISSIONS.INTEGRATION_MANAGE, category: 'integration' },
  { key: PERMISSIONS.TICKET_VIEW, category: 'support' },
  { key: PERMISSIONS.TICKET_VIEW_ALL, category: 'support' },
  { key: PERMISSIONS.TICKET_REPLY, category: 'support' },
  { key: PERMISSIONS.TICKET_NOTE, category: 'support' },
  { key: PERMISSIONS.TICKET_ASSIGN, category: 'support' },
  { key: PERMISSIONS.TICKET_SET_STATUS, category: 'support' },
  { key: PERMISSIONS.TICKET_CREATE, category: 'support' },
  { key: PERMISSIONS.TICKET_MANAGE_TYPES, category: 'support' },
  { key: PERMISSIONS.SLA_MANAGE, category: 'support' },
  { key: PERMISSIONS.ROUTING_MANAGE, category: 'support' },
  { key: PERMISSIONS.TEAM_MANAGE, category: 'support' },
  { key: PERMISSIONS.WORKFLOW_MANAGE, category: 'support' },
  { key: PERMISSIONS.CHANNEL_ACCOUNT_MANAGE, category: 'support' },
  { key: PERMISSIONS.ASSISTANT_MANAGE, category: 'ai' },
  { key: PERMISSIONS.CONNECTOR_MANAGE, category: 'ai' },
  { key: PERMISSIONS.COPILOT_USE, category: 'ai' },
  { key: PERMISSIONS.STATUS_PAGE_MANAGE, category: 'status_page' },
  { key: PERMISSIONS.STATUS_PAGE_PUBLISH, category: 'status_page' },
]
