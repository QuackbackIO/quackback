/**
 * RBAC permission catalogue — the code-authoritative contract.
 *
 * Pure data, zero runtime deps, so the seed and the client both import it
 * without dragging in drizzle or the app. The `permissions` table rows are
 * seeded from this on deploy (for UI joins + `category` grouping); adding a
 * key is a TypeScript change plus a reconciling seed, never a schema migration.
 *
 * Keys are `noun.verb`; the UI grouping lives in the SEPARATE `category` field,
 * never the key prefix. Presets and the admin boundary are explicit permission
 * lists (never string-prefix filters), so adding a key can never silently widen
 * a role. Renaming or removing a key is breaking once a custom role or an API
 * consumer references it.
 *
 * A client-safe mirror lives at apps/web/src/lib/shared/permissions.ts and is
 * kept identical by a drift test.
 */

export const PERMISSIONS = {
  // category 'workspace' — workspace-level admin singletons (all in WORKSPACE_ADMIN_PERMISSIONS)
  SETTINGS_MANAGE: 'settings.manage', // branding, general config, portal/widget, moderation default
  BILLING_MANAGE: 'billing.manage', // cloud billing (Owner-only by default)
  ROLE_MANAGE: 'role.manage', // create / edit custom roles
  API_KEY_MANAGE: 'api_key.manage',
  WEBHOOK_VIEW: 'webhook.view', // read outbound webhook subscriptions
  WEBHOOK_MANAGE: 'webhook.manage', // create / edit / rotate webhook subscriptions + secrets
  AUTH_MANAGE: 'auth.manage', // SSO / identity providers / 2FA policy
  AUDIT_VIEW: 'audit.view',

  // category 'members' — teammates
  MEMBER_VIEW: 'member.view', // read the teammate roster + assignee / owner pickers
  MEMBER_MANAGE: 'member.manage', // invite / remove / change a teammate's roles

  // category 'people' — the People directory (end-users: visitor / lead / user)
  PEOPLE_VIEW: 'people.view', // browse people + their lifecycle stage
  PEOPLE_MANAGE: 'people.manage', // edit + the lead -> user merge

  // category 'company' — the Companies directory (the B2B companies object)
  COMPANY_VIEW: 'company.view', // browse companies + plan / MRR context in the inbox
  COMPANY_MANAGE: 'company.manage', // edit company records + person <-> company links

  // category 'audience' — targeting
  SEGMENT_VIEW: 'segment.view',
  SEGMENT_MANAGE: 'segment.manage',
  USER_ATTRIBUTE_VIEW: 'user_attribute.view',
  USER_ATTRIBUTE_MANAGE: 'user_attribute.manage',

  // category 'feedback'
  POST_VIEW_PRIVATE: 'post.view_private', // internal / private posts
  POST_CREATE: 'post.create',
  POST_MODERATE: 'post.moderate', // edit / merge / triage / status / pin / delete EXISTING posts
  POST_APPROVE: 'post.approve', // approve / reject the pre-publication moderation queue
  POST_VOTE_ON_BEHALF: 'post.vote_on_behalf',
  COMMENT_MODERATE: 'comment.moderate', // edit / delete others' comments
  BOARD_MANAGE: 'board.manage', // create / edit / delete boards + access matrix
  ROADMAP_MANAGE: 'roadmap.manage',
  STATUS_VIEW: 'status.view', // read the post-status taxonomy (pickers)
  STATUS_MANAGE: 'status.manage', // create / edit / reorder / delete post statuses
  TAG_VIEW: 'tag.view', // read the tag taxonomy (pickers)
  TAG_MANAGE: 'tag.manage', // create / edit / delete tag definitions
  SUGGESTION_VIEW: 'suggestion.view', // read the AI feedback-suggestions triage queue
  SUGGESTION_MANAGE: 'suggestion.manage', // accept / dismiss / restore / retry suggestions

  // category 'changelog'
  CHANGELOG_VIEW_DRAFT: 'changelog.view_draft',
  CHANGELOG_MANAGE: 'changelog.manage', // create / edit / publish / delete

  // category 'help_center'
  HELP_CENTER_MANAGE: 'help_center.manage', // articles / categories

  // category 'conversation' (the inbox)
  CONVERSATION_VIEW: 'conversation.view',
  CONVERSATION_REPLY: 'conversation.reply',
  CONVERSATION_NOTE: 'conversation.note', // internal note
  CONVERSATION_ASSIGN: 'conversation.assign',
  CONVERSATION_MANAGE: 'conversation.manage', // status / tags / canned replies admin / delete

  // category 'analytics'
  ANALYTICS_VIEW: 'analytics.view',

  // category 'integration'
  INTEGRATION_VIEW: 'integration.view', // list connected integrations + in-inbox CRM lookups
  INTEGRATION_MANAGE: 'integration.manage', // connect / configure / secrets

  // category 'support' — seeded, dormant until the support platform lands
  TICKET_VIEW_ALL: 'ticket.view_all',
  TICKET_VIEW_ASSIGNED: 'ticket.view_assigned',
  TICKET_REPLY: 'ticket.reply',
  TICKET_NOTE: 'ticket.note', // internal note (matches conversation.note)
  TICKET_ASSIGN: 'ticket.assign',
  SLA_MANAGE: 'sla.manage',
  INBOX_MANAGE: 'inbox.manage',
  ROUTING_MANAGE: 'routing.manage',
  TEAM_MANAGE: 'team.manage',
} as const

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

/** Every catalogue key as a flat array. The source of `owner` / `admin` bundles. */
export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as PermissionKey[]

/** Coarse grouping for the matrix UI; the `permissions.category` column value. */
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

/** Full per-key metadata: the seed reconciles `category` + `description` from this. */
export const PERMISSION_CATALOGUE: ReadonlyArray<{
  key: PermissionKey
  category: PermissionCategory
  description: string
}> = [
  {
    key: PERMISSIONS.SETTINGS_MANAGE,
    category: 'workspace',
    description:
      'Manage workspace settings: branding, general config, portal and widget, moderation default',
  },
  {
    key: PERMISSIONS.BILLING_MANAGE,
    category: 'workspace',
    description: 'Manage billing and subscription',
  },
  {
    key: PERMISSIONS.ROLE_MANAGE,
    category: 'workspace',
    description: 'Create and edit custom roles',
  },
  {
    key: PERMISSIONS.API_KEY_MANAGE,
    category: 'workspace',
    description: 'Create, rotate, and revoke API keys',
  },
  {
    key: PERMISSIONS.WEBHOOK_VIEW,
    category: 'workspace',
    description: 'View outbound webhook subscriptions',
  },
  {
    key: PERMISSIONS.WEBHOOK_MANAGE,
    category: 'workspace',
    description: 'Create, edit, and rotate webhook subscriptions and secrets',
  },
  {
    key: PERMISSIONS.AUTH_MANAGE,
    category: 'workspace',
    description: 'Manage SSO, identity providers, and the 2FA policy',
  },
  { key: PERMISSIONS.AUDIT_VIEW, category: 'workspace', description: 'View the audit log' },

  {
    key: PERMISSIONS.MEMBER_VIEW,
    category: 'members',
    description: 'View the teammate roster and assignee / owner pickers',
  },
  {
    key: PERMISSIONS.MEMBER_MANAGE,
    category: 'members',
    description: "Invite, remove, and change a teammate's roles",
  },

  {
    key: PERMISSIONS.PEOPLE_VIEW,
    category: 'people',
    description: 'Browse people and their lifecycle stage',
  },
  {
    key: PERMISSIONS.PEOPLE_MANAGE,
    category: 'people',
    description: 'Edit people and merge a lead into an identified user',
  },

  {
    key: PERMISSIONS.COMPANY_VIEW,
    category: 'company',
    description: 'Browse companies and their plan / MRR context',
  },
  {
    key: PERMISSIONS.COMPANY_MANAGE,
    category: 'company',
    description: 'Edit company records and person-to-company links',
  },

  { key: PERMISSIONS.SEGMENT_VIEW, category: 'audience', description: 'View segments' },
  {
    key: PERMISSIONS.SEGMENT_MANAGE,
    category: 'audience',
    description: 'Create, edit, and delete segments',
  },
  {
    key: PERMISSIONS.USER_ATTRIBUTE_VIEW,
    category: 'audience',
    description: 'View user attribute definitions',
  },
  {
    key: PERMISSIONS.USER_ATTRIBUTE_MANAGE,
    category: 'audience',
    description: 'Create, edit, and delete user attribute definitions',
  },

  {
    key: PERMISSIONS.POST_VIEW_PRIVATE,
    category: 'feedback',
    description: 'View internal / private posts',
  },
  { key: PERMISSIONS.POST_CREATE, category: 'feedback', description: 'Create posts' },
  {
    key: PERMISSIONS.POST_MODERATE,
    category: 'feedback',
    description: 'Edit, merge, triage, status, pin, and delete existing posts',
  },
  {
    key: PERMISSIONS.POST_APPROVE,
    category: 'feedback',
    description: 'Approve or reject the pre-publication moderation queue',
  },
  {
    key: PERMISSIONS.POST_VOTE_ON_BEHALF,
    category: 'feedback',
    description: 'Cast votes on behalf of another person',
  },
  {
    key: PERMISSIONS.COMMENT_MODERATE,
    category: 'feedback',
    description: "Edit and delete others' comments",
  },
  {
    key: PERMISSIONS.BOARD_MANAGE,
    category: 'feedback',
    description: 'Create, edit, and delete boards and the board access matrix',
  },
  {
    key: PERMISSIONS.ROADMAP_MANAGE,
    category: 'feedback',
    description: 'Create, edit, and delete roadmaps',
  },
  {
    key: PERMISSIONS.STATUS_VIEW,
    category: 'feedback',
    description: 'Read the post-status taxonomy (pickers)',
  },
  {
    key: PERMISSIONS.STATUS_MANAGE,
    category: 'feedback',
    description: 'Create, edit, reorder, and delete post statuses',
  },
  {
    key: PERMISSIONS.TAG_VIEW,
    category: 'feedback',
    description: 'Read the tag taxonomy (pickers)',
  },
  {
    key: PERMISSIONS.TAG_MANAGE,
    category: 'feedback',
    description: 'Create, edit, and delete tag definitions',
  },
  {
    key: PERMISSIONS.SUGGESTION_VIEW,
    category: 'feedback',
    description: 'Read the AI feedback-suggestions triage queue',
  },
  {
    key: PERMISSIONS.SUGGESTION_MANAGE,
    category: 'feedback',
    description: 'Accept, dismiss, restore, and retry feedback suggestions',
  },

  {
    key: PERMISSIONS.CHANGELOG_VIEW_DRAFT,
    category: 'changelog',
    description: 'View draft changelog entries',
  },
  {
    key: PERMISSIONS.CHANGELOG_MANAGE,
    category: 'changelog',
    description: 'Create, edit, publish, and delete changelog entries',
  },

  {
    key: PERMISSIONS.HELP_CENTER_MANAGE,
    category: 'help_center',
    description: 'Manage help center articles and categories',
  },

  {
    key: PERMISSIONS.CONVERSATION_VIEW,
    category: 'conversation',
    description: 'View conversations in the inbox',
  },
  {
    key: PERMISSIONS.CONVERSATION_REPLY,
    category: 'conversation',
    description: 'Reply to conversations',
  },
  {
    key: PERMISSIONS.CONVERSATION_NOTE,
    category: 'conversation',
    description: 'Add internal notes to conversations',
  },
  {
    key: PERMISSIONS.CONVERSATION_ASSIGN,
    category: 'conversation',
    description: 'Assign conversations',
  },
  {
    key: PERMISSIONS.CONVERSATION_MANAGE,
    category: 'conversation',
    description: 'Manage conversation status, tags, canned replies, and deletion',
  },

  { key: PERMISSIONS.ANALYTICS_VIEW, category: 'analytics', description: 'View analytics' },

  {
    key: PERMISSIONS.INTEGRATION_VIEW,
    category: 'integration',
    description: 'List connected integrations and run in-inbox CRM lookups',
  },
  {
    key: PERMISSIONS.INTEGRATION_MANAGE,
    category: 'integration',
    description: 'Connect, configure, and manage integration secrets',
  },

  { key: PERMISSIONS.TICKET_VIEW_ALL, category: 'support', description: 'View all tickets' },
  {
    key: PERMISSIONS.TICKET_VIEW_ASSIGNED,
    category: 'support',
    description: 'View assigned tickets',
  },
  { key: PERMISSIONS.TICKET_REPLY, category: 'support', description: 'Reply to tickets' },
  {
    key: PERMISSIONS.TICKET_NOTE,
    category: 'support',
    description: 'Add internal notes to tickets',
  },
  { key: PERMISSIONS.TICKET_ASSIGN, category: 'support', description: 'Assign tickets' },
  { key: PERMISSIONS.SLA_MANAGE, category: 'support', description: 'Manage SLA policies' },
  { key: PERMISSIONS.INBOX_MANAGE, category: 'support', description: 'Manage inboxes' },
  { key: PERMISSIONS.ROUTING_MANAGE, category: 'support', description: 'Manage routing rules' },
  { key: PERMISSIONS.TEAM_MANAGE, category: 'support', description: 'Manage support teams' },
]

// --------------------------------------------------------------- presets ---

export const SYSTEM_ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MANAGER: 'manager',
  CONTRIBUTOR: 'contributor',
} as const

export type SystemRoleKey = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES]

/**
 * The workspace-admin permissions: Owner + Admin only, and the boundary that
 * defines Manager ("everything except these"). An explicit list, NOT a string
 * prefix or a category, so adding a permission can never silently widen Manager.
 * member.manage and integration.manage live here even though their UI categories
 * pair them with their .view siblings.
 */
export const WORKSPACE_ADMIN_PERMISSIONS: readonly PermissionKey[] = [
  PERMISSIONS.SETTINGS_MANAGE,
  PERMISSIONS.BILLING_MANAGE,
  PERMISSIONS.MEMBER_MANAGE,
  PERMISSIONS.ROLE_MANAGE,
  PERMISSIONS.API_KEY_MANAGE,
  PERMISSIONS.WEBHOOK_VIEW,
  PERMISSIONS.WEBHOOK_MANAGE,
  PERMISSIONS.AUTH_MANAGE,
  PERMISSIONS.INTEGRATION_MANAGE,
  PERMISSIONS.AUDIT_VIEW,
]

export const SYSTEM_ROLE_PERMISSIONS: Record<SystemRoleKey, PermissionKey[]> = {
  owner: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS.filter((p) => p !== PERMISSIONS.BILLING_MANAGE),
  // Everything except the workspace-admin set; this naturally keeps member.view +
  // integration.view (not in the set) while excluding member.manage / integration.manage.
  manager: ALL_PERMISSIONS.filter((p) => !WORKSPACE_ADMIN_PERMISSIONS.includes(p)),
  // Broad cross-domain operator: works feedback + (later) support queues; does not
  // configure product structure or settings. The support operate permissions are
  // appended here by default when the platform lands.
  contributor: [
    PERMISSIONS.POST_VIEW_PRIVATE,
    PERMISSIONS.POST_CREATE,
    PERMISSIONS.POST_MODERATE,
    PERMISSIONS.POST_APPROVE,
    PERMISSIONS.POST_VOTE_ON_BEHALF,
    PERMISSIONS.COMMENT_MODERATE,
    PERMISSIONS.CHANGELOG_VIEW_DRAFT,
    PERMISSIONS.CONVERSATION_VIEW,
    PERMISSIONS.CONVERSATION_REPLY,
    PERMISSIONS.CONVERSATION_NOTE,
    PERMISSIONS.CONVERSATION_ASSIGN,
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
  ],
}

/** Seed metadata for the four `is_system` roles (name + description columns). */
export const SYSTEM_ROLE_DEFS: ReadonlyArray<{
  key: SystemRoleKey
  name: string
  description: string
}> = [
  {
    key: SYSTEM_ROLES.OWNER,
    name: 'Owner',
    description: 'Full access, including billing and role management',
  },
  { key: SYSTEM_ROLES.ADMIN, name: 'Admin', description: 'Full access except billing' },
  {
    key: SYSTEM_ROLES.MANAGER,
    name: 'Manager',
    description:
      'Configures and operates the whole product and inbox; no workspace-admin permissions',
  },
  {
    key: SYSTEM_ROLES.CONTRIBUTOR,
    name: 'Contributor',
    description:
      'Cross-domain operator: works feedback and support queues; does not configure product structure or settings',
  },
]

/**
 * Legacy `principal.role` -> system role preset. The non-regressing backfill
 * mapping: admin -> Owner, member -> Manager, user -> no assignment (People axis).
 */
export function presetForLegacyRole(role: string): SystemRoleKey | null {
  if (role === 'admin') return SYSTEM_ROLES.OWNER
  if (role === 'member') return SYSTEM_ROLES.MANAGER
  return null
}
