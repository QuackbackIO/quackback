/**
 * Permission catalogue for the ticketing module (and the broader workspace).
 *
 * Permissions are dotted machine names. A role bundle is a set of permissions.
 * A grant (`principal_role_assignments`) attaches a role to a principal,
 * optionally scoped to a team — see `authz.scopes.ts` for how that scope
 * narrows action evaluation.
 *
 * Adding a permission here is purely a TypeScript change; the migration that
 * seeds the system roles will reconcile the rows on next deploy.
 */

export const PERMISSIONS = {
  // Ticket access (record-level)
  TICKET_VIEW_ALL: 'ticket.view_all',
  TICKET_VIEW_TEAM: 'ticket.view_team',
  TICKET_VIEW_ASSIGNED: 'ticket.view_assigned',
  TICKET_VIEW_SHARED: 'ticket.view_shared',

  // Ticket actions
  TICKET_REPLY_PUBLIC: 'ticket.reply_public',
  TICKET_COMMENT_INTERNAL: 'ticket.comment_internal',
  TICKET_EDIT_FIELDS: 'ticket.edit_fields',
  TICKET_ASSIGN_SELF: 'ticket.assign_self',
  TICKET_ASSIGN_ANY: 'ticket.assign_any',
  TICKET_SHARE_CROSS_TEAM: 'ticket.share_cross_team',
  TICKET_MANAGE_PARTICIPANTS: 'ticket.manage_participants',

  // Organization & contact
  ORG_VIEW: 'org.view',
  ORG_MANAGE: 'org.manage',

  // SLA
  SLA_VIEW: 'sla.view',
  SLA_MANAGE: 'sla.manage',
  BUSINESS_HOURS_MANAGE: 'business_hours.manage',
  ESCALATION_RULE_MANAGE: 'escalation.rule_manage',

  // Audit
  AUDIT_VIEW: 'audit.view',

  // Inboxes & routing (Phase 4)
  INBOX_VIEW: 'inbox.view',
  INBOX_MANAGE: 'inbox.manage',
  INBOX_CHANNEL_MANAGE: 'inbox.channel_manage',
  ROUTING_RULE_MANAGE: 'routing.rule_manage',
  TICKET_BULK_OPERATE: 'ticket.bulk_operate',

  // Admin
  ADMIN_MANAGE_USERS: 'admin.manage_users',
  ADMIN_MANAGE_ROLES: 'admin.manage_roles',
  ADMIN_MANAGE_API_KEYS: 'admin.manage_api_keys',
  ADMIN_MANAGE_SETTINGS: 'admin.manage_settings',

  // Teams (workspace structure)
  TEAM_VIEW: 'team.view',
  TEAM_MANAGE: 'team.manage',

  // Audience & segmentation
  SEGMENT_VIEW: 'segment.view',
  SEGMENT_MANAGE: 'segment.manage',
  USER_ATTRIBUTE_VIEW: 'user_attribute.view',
  USER_ATTRIBUTE_MANAGE: 'user_attribute.manage',

  // Portal & widget configuration
  PORTAL_MANAGE: 'portal.manage',
  WIDGET_VIEW: 'widget.view',
  WIDGET_MANAGE: 'widget.manage',

  // Conversations / live chat
  CHAT_VIEW: 'chat.view',
  CHAT_MANAGE: 'chat.manage',

  // Content moderation
  MODERATION_VIEW: 'moderation.view',
  MODERATION_MANAGE: 'moderation.manage',
} as const

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

export const ALL_PERMISSIONS: readonly PermissionKey[] = Object.values(PERMISSIONS)

/**
 * Permissions grouped by UI category. Used by the permissions admin page
 * and by the seed migration to populate the `permissions.category` column.
 */
export const PERMISSION_CATEGORIES: Record<string, readonly PermissionKey[]> = {
  ticket: [
    PERMISSIONS.TICKET_VIEW_ALL,
    PERMISSIONS.TICKET_VIEW_TEAM,
    PERMISSIONS.TICKET_VIEW_ASSIGNED,
    PERMISSIONS.TICKET_VIEW_SHARED,
    PERMISSIONS.TICKET_REPLY_PUBLIC,
    PERMISSIONS.TICKET_COMMENT_INTERNAL,
    PERMISSIONS.TICKET_EDIT_FIELDS,
    PERMISSIONS.TICKET_ASSIGN_SELF,
    PERMISSIONS.TICKET_ASSIGN_ANY,
    PERMISSIONS.TICKET_SHARE_CROSS_TEAM,
    PERMISSIONS.TICKET_MANAGE_PARTICIPANTS,
  ],
  org: [PERMISSIONS.ORG_VIEW, PERMISSIONS.ORG_MANAGE],
  sla: [
    PERMISSIONS.SLA_VIEW,
    PERMISSIONS.SLA_MANAGE,
    PERMISSIONS.BUSINESS_HOURS_MANAGE,
    PERMISSIONS.ESCALATION_RULE_MANAGE,
  ],
  audit: [PERMISSIONS.AUDIT_VIEW],
  inbox: [
    PERMISSIONS.INBOX_VIEW,
    PERMISSIONS.INBOX_MANAGE,
    PERMISSIONS.INBOX_CHANNEL_MANAGE,
    PERMISSIONS.ROUTING_RULE_MANAGE,
    PERMISSIONS.TICKET_BULK_OPERATE,
  ],
  admin: [
    PERMISSIONS.ADMIN_MANAGE_USERS,
    PERMISSIONS.ADMIN_MANAGE_ROLES,
    PERMISSIONS.ADMIN_MANAGE_API_KEYS,
    PERMISSIONS.ADMIN_MANAGE_SETTINGS,
  ],
  team: [PERMISSIONS.TEAM_VIEW, PERMISSIONS.TEAM_MANAGE],
  audience: [
    PERMISSIONS.SEGMENT_VIEW,
    PERMISSIONS.SEGMENT_MANAGE,
    PERMISSIONS.USER_ATTRIBUTE_VIEW,
    PERMISSIONS.USER_ATTRIBUTE_MANAGE,
  ],
  portal: [PERMISSIONS.PORTAL_MANAGE, PERMISSIONS.WIDGET_VIEW, PERMISSIONS.WIDGET_MANAGE],
  chat: [PERMISSIONS.CHAT_VIEW, PERMISSIONS.CHAT_MANAGE],
  moderation: [PERMISSIONS.MODERATION_VIEW, PERMISSIONS.MODERATION_MANAGE],
}

/**
 * System role bundles. Seeded by migration; can be cloned/edited from the UI
 * but not deleted (see `roles.is_system`).
 *
 * The legacy `principal.role` cache maps as follows:
 *   - principal.role === 'admin'  → SYSTEM_ROLES.OWNER
 *   - principal.role === 'member' → SYSTEM_ROLES.AGENT (default landing role
 *                                    for existing team members; admins can
 *                                    promote to SUPERVISOR)
 *   - principal.role === 'user'   → SYSTEM_ROLES.CUSTOMER
 */
export const SYSTEM_ROLES = {
  OWNER: 'owner',
  SUPERVISOR: 'supervisor',
  AGENT: 'agent',
  COLLABORATOR: 'collaborator',
  CUSTOMER: 'customer',
} as const

export type SystemRoleKey = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES]

/**
 * Which permissions each system role bundle includes.
 * Owner has every permission (computed dynamically to stay in sync with
 * `PERMISSIONS`).
 */
export const SYSTEM_ROLE_PERMISSIONS: Record<SystemRoleKey, readonly PermissionKey[]> = {
  [SYSTEM_ROLES.OWNER]: ALL_PERMISSIONS,

  [SYSTEM_ROLES.SUPERVISOR]: [
    PERMISSIONS.TICKET_VIEW_ALL,
    PERMISSIONS.TICKET_VIEW_TEAM,
    PERMISSIONS.TICKET_VIEW_ASSIGNED,
    PERMISSIONS.TICKET_VIEW_SHARED,
    PERMISSIONS.TICKET_REPLY_PUBLIC,
    PERMISSIONS.TICKET_COMMENT_INTERNAL,
    PERMISSIONS.TICKET_EDIT_FIELDS,
    PERMISSIONS.TICKET_ASSIGN_SELF,
    PERMISSIONS.TICKET_ASSIGN_ANY,
    PERMISSIONS.TICKET_SHARE_CROSS_TEAM,
    PERMISSIONS.TICKET_MANAGE_PARTICIPANTS,
    PERMISSIONS.ORG_VIEW,
    PERMISSIONS.ORG_MANAGE,
    PERMISSIONS.SLA_VIEW,
    PERMISSIONS.SLA_MANAGE,
    PERMISSIONS.BUSINESS_HOURS_MANAGE,
    PERMISSIONS.ESCALATION_RULE_MANAGE,
    PERMISSIONS.AUDIT_VIEW,
    PERMISSIONS.INBOX_VIEW,
    PERMISSIONS.INBOX_MANAGE,
    PERMISSIONS.INBOX_CHANNEL_MANAGE,
    PERMISSIONS.ROUTING_RULE_MANAGE,
    PERMISSIONS.TICKET_BULK_OPERATE,
    // Workspace structure + operational config (admin.* stays owner-only)
    PERMISSIONS.TEAM_VIEW,
    PERMISSIONS.TEAM_MANAGE,
    PERMISSIONS.SEGMENT_VIEW,
    PERMISSIONS.SEGMENT_MANAGE,
    PERMISSIONS.USER_ATTRIBUTE_VIEW,
    PERMISSIONS.USER_ATTRIBUTE_MANAGE,
    PERMISSIONS.PORTAL_MANAGE,
    PERMISSIONS.WIDGET_VIEW,
    PERMISSIONS.WIDGET_MANAGE,
    PERMISSIONS.CHAT_VIEW,
    PERMISSIONS.CHAT_MANAGE,
    PERMISSIONS.MODERATION_VIEW,
    PERMISSIONS.MODERATION_MANAGE,
  ],

  [SYSTEM_ROLES.AGENT]: [
    PERMISSIONS.TICKET_VIEW_TEAM,
    PERMISSIONS.TICKET_VIEW_ASSIGNED,
    PERMISSIONS.TICKET_VIEW_SHARED,
    PERMISSIONS.TICKET_REPLY_PUBLIC,
    PERMISSIONS.TICKET_COMMENT_INTERNAL,
    PERMISSIONS.TICKET_EDIT_FIELDS,
    PERMISSIONS.TICKET_ASSIGN_SELF,
    PERMISSIONS.ORG_VIEW,
    PERMISSIONS.SLA_VIEW,
    PERMISSIONS.INBOX_VIEW,
    PERMISSIONS.TICKET_BULK_OPERATE,
    // Front-line agents handle conversations and need read context
    PERMISSIONS.CHAT_VIEW,
    PERMISSIONS.CHAT_MANAGE,
    PERMISSIONS.TEAM_VIEW,
    PERMISSIONS.SEGMENT_VIEW,
  ],

  [SYSTEM_ROLES.COLLABORATOR]: [
    PERMISSIONS.TICKET_VIEW_SHARED,
    PERMISSIONS.TICKET_VIEW_ASSIGNED,
    PERMISSIONS.TICKET_COMMENT_INTERNAL,
    PERMISSIONS.ORG_VIEW,
  ],

  // Customer role intentionally has no internal-side permissions; portal-side
  // access is handled by the existing portal session helpers.
  [SYSTEM_ROLES.CUSTOMER]: [],
}
