/**
 * Who can open each settings page: the one place the page's route, the
 * settings nav and the module tabs read it from, so a role either sees a page
 * that works or does not see it at all.
 *
 * A page's gate is what the page needs to work: the permissions its loader's
 * reads require (a refused read fails the whole page), plus, where the page's
 * reads are lists other screens show too, the permission its controls need
 * (`SETTINGS_PAGE_ACTIONS`). A part of a page that needs more than the page
 * (a tab, a card) is hidden from a viewer without it, and not read for them.
 * settings-page-access.test.ts reads every settings route's loader and the
 * server functions behind it, and fails when a gate and those reads disagree.
 */
import { redirect } from '@tanstack/react-router'
import { buildSigninRedirect } from './auth-prompt'
import { PERMISSIONS, type PermissionKey } from './permissions'
import { AI_ANY_PERMISSIONS } from './ai-permissions'
import { DOMAINS_PAGE_PERMISSIONS } from './domains-permissions'
import { PORTAL_PAGE_GATE } from './portal-settings-tabs'
import { EMAIL_SENDING_PERMISSION } from './email-sending-permissions'

/**
 * The ways into a page: a viewer who holds every permission of any one of
 * these lists opens it. Most pages have one list of one permission.
 */
export type PageGate = readonly (readonly PermissionKey[])[]

const one = (permission: PermissionKey): PageGate => [[permission]]
const all = (...permissions: PermissionKey[]): PageGate => [permissions]
const any = (permissions: readonly PermissionKey[]): PageGate => permissions.map((p) => [p])

export const SETTINGS_PAGE_ACCESS = {
  // Feedback & Roadmaps
  '/admin/settings/boards': one(PERMISSIONS.BOARD_MANAGE),
  '/admin/settings/boards/$slug': one(PERMISSIONS.BOARD_MANAGE),
  // Each lists under its view permission and changes under its manage one.
  '/admin/settings/statuses': all(PERMISSIONS.STATUS_MANAGE, PERMISSIONS.STATUS_VIEW),
  '/admin/settings/tags': all(PERMISSIONS.TAG_MANAGE, PERMISSIONS.TAG_VIEW),
  // Reads the portal config (settings.manage); saves under settings.moderation.
  '/admin/settings/moderation': all(PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.SETTINGS_MODERATION),
  // Support
  '/admin/settings/channels': one(PERMISSIONS.SETTINGS_MANAGE),
  '/admin/settings/channels/messenger': one(PERMISSIONS.SETTINGS_MANAGE),
  '/admin/settings/channels/email': one(PERMISSIONS.CHANNEL_ACCOUNT_MANAGE),
  // Reads the connection status (settings.manage); its switch saves under
  // channel_account.manage.
  '/admin/settings/channels/github': all(
    PERMISSIONS.SETTINGS_MANAGE,
    PERMISSIONS.CHANNEL_ACCOUNT_MANAGE
  ),
  // Changes macros (conversation.manage); lists them (conversation.reply).
  '/admin/settings/macros': all(PERMISSIONS.CONVERSATION_MANAGE, PERMISSIONS.CONVERSATION_REPLY),
  '/admin/settings/office-hours': one(PERMISSIONS.OFFICE_HOURS_MANAGE),
  '/admin/settings/sla': one(PERMISSIONS.SLA_MANAGE),
  '/admin/settings/ticket-types': one(PERMISSIONS.TICKET_MANAGE_TYPES),
  '/admin/settings/ticket-statuses': all(PERMISSIONS.TICKET_MANAGE_TYPES, PERMISSIONS.TICKET_VIEW),
  // Other product modules
  '/admin/settings/help-center': one(PERMISSIONS.HELP_CENTER_MANAGE),
  '/admin/settings/changelog': one(PERMISSIONS.CHANGELOG_MANAGE),
  '/admin/settings/status': one(PERMISSIONS.STATUS_PAGE_MANAGE),
  // AI & Automation
  '/admin/settings/agent': one(PERMISSIONS.AI_CUSTOMER_MANAGE),
  '/admin/settings/copilot': one(PERMISSIONS.AI_TEAMMATE_MANAGE),
  '/admin/settings/skills': any(AI_ANY_PERMISSIONS),
  '/admin/settings/connectors': any(AI_ANY_PERMISSIONS),
  '/admin/settings/connectors/$connectorId': any(AI_ANY_PERMISSIONS),
  // Workflows are read under routing.manage and changed under workflow.manage.
  '/admin/settings/workflows': all(PERMISSIONS.ROUTING_MANAGE, PERMISSIONS.WORKFLOW_MANAGE),
  '/admin/settings/workflows/$workflowId': all(
    PERMISSIONS.ROUTING_MANAGE,
    PERMISSIONS.WORKFLOW_MANAGE
  ),
  // Workspace
  '/admin/settings/general': one(PERMISSIONS.SETTINGS_MANAGE),
  '/admin/settings/domains': any(DOMAINS_PAGE_PERMISSIONS),
  '/admin/settings/domains/$domain': any(DOMAINS_PAGE_PERMISSIONS),
  '/admin/settings/email': one(EMAIL_SENDING_PERMISSION),
  // Design needs settings.branding and settings.manage; Custom domains settings.custom_domain.
  '/admin/settings/portal': PORTAL_PAGE_GATE,
  '/admin/settings/widget': one(PERMISSIONS.SETTINGS_MANAGE),
  '/admin/settings/widget/install': one(PERMISSIONS.SETTINGS_MANAGE),
  '/admin/settings/members': one(PERMISSIONS.MEMBER_VIEW),
  '/admin/settings/members/roles/$roleId': one(PERMISSIONS.MEMBER_VIEW),
  // Creates a role (role.manage) from the roles list (member.view).
  '/admin/settings/members/roles/new': all(PERMISSIONS.ROLE_MANAGE, PERMISSIONS.MEMBER_VIEW),
  // Its Portal access tab needs settings.manage, its Audit log tab audit.view:
  // each shows only to a holder (authentication-tabs.ts).
  '/admin/settings/security/authentication': one(PERMISSIONS.AUTH_MANAGE),
  '/admin/settings/security/sso/$providerId': one(PERMISSIONS.AUTH_MANAGE),
  '/admin/settings/security/sso/new': one(PERMISSIONS.AUTH_MANAGE),
  '/admin/settings/developers': one(PERMISSIONS.API_KEY_MANAGE),
  '/admin/settings/developers/workspace-keys/new': one(PERMISSIONS.API_KEY_MANAGE),
  '/admin/settings/labs': one(PERMISSIONS.SETTINGS_MANAGE),
  '/admin/settings/integrations': one(PERMISSIONS.INTEGRATION_VIEW),
  // An integration's own page reads and changes its setup.
  '/admin/settings/integrations/$type': one(PERMISSIONS.INTEGRATION_MANAGE),
  '/admin/settings/billing': one(PERMISSIONS.BILLING_MANAGE),
  '/admin/settings/billing/checkout': one(PERMISSIONS.BILLING_MANAGE),
  '/admin/settings/billing/limits': one(PERMISSIONS.MEMBER_VIEW),
  // Data
  '/admin/settings/people': one(PERMISSIONS.USER_ATTRIBUTE_VIEW),
  '/admin/settings/companies': one(PERMISSIONS.COMPANY_VIEW),
  '/admin/settings/conversation-data': all(
    PERMISSIONS.CONVERSATION_MANAGE,
    PERMISSIONS.CONVERSATION_VIEW
  ),
  '/admin/settings/imports': one(PERMISSIONS.SETTINGS_MANAGE),
} as const satisfies Record<string, PageGate>

export type GatedSettingsPage = keyof typeof SETTINGS_PAGE_ACCESS

/**
 * Permissions a gate asks for beyond its page's reads, and why: what every
 * control on the page needs. A page whose reads are lists other screens show
 * too (the tag picker, the status menu) stays closed to a viewer who may only
 * read them, rather than opening on controls that each fail; and a page with
 * no gated read of its own is gated on what it sets up.
 */
export const SETTINGS_PAGE_ACTIONS: Partial<Record<GatedSettingsPage, readonly PermissionKey[]>> = {
  '/admin/settings/statuses': [PERMISSIONS.STATUS_MANAGE],
  '/admin/settings/tags': [PERMISSIONS.TAG_MANAGE],
  '/admin/settings/ticket-statuses': [PERMISSIONS.TICKET_MANAGE_TYPES],
  '/admin/settings/conversation-data': [PERMISSIONS.CONVERSATION_MANAGE],
  '/admin/settings/macros': [PERMISSIONS.CONVERSATION_MANAGE],
  '/admin/settings/moderation': [PERMISSIONS.SETTINGS_MODERATION],
  '/admin/settings/channels/github': [PERMISSIONS.CHANNEL_ACCOUNT_MANAGE],
  '/admin/settings/workflows': [PERMISSIONS.WORKFLOW_MANAGE],
  '/admin/settings/workflows/$workflowId': [PERMISSIONS.WORKFLOW_MANAGE],
  // The assistant settings read is shared by both AI pages.
  '/admin/settings/agent': [PERMISSIONS.AI_CUSTOMER_MANAGE],
  '/admin/settings/copilot': [PERMISSIONS.AI_TEAMMATE_MANAGE],
  '/admin/settings/members/roles/new': [PERMISSIONS.ROLE_MANAGE],
  // No gated read of their own.
  '/admin/settings/channels/email': [PERMISSIONS.CHANNEL_ACCOUNT_MANAGE],
  '/admin/settings/domains': DOMAINS_PAGE_PERMISSIONS,
  '/admin/settings/domains/$domain': DOMAINS_PAGE_PERMISSIONS,
  '/admin/settings/portal': [
    PERMISSIONS.SETTINGS_BRANDING,
    PERMISSIONS.SETTINGS_MANAGE,
    PERMISSIONS.SETTINGS_CUSTOM_DOMAIN,
  ],
  '/admin/settings/security/sso/new': [PERMISSIONS.AUTH_MANAGE],
  '/admin/settings/developers/workspace-keys/new': [PERMISSIONS.API_KEY_MANAGE],
  '/admin/settings/labs': [PERMISSIONS.SETTINGS_MANAGE],
  '/admin/settings/imports': [PERMISSIONS.SETTINGS_MANAGE],
}

/** Whether `permissions` opens a page with this gate. */
export function holdsPageGate(
  permissions: ReadonlySet<string> | readonly string[] | undefined,
  gate: PageGate
): boolean {
  if (!permissions) return false
  const holds = Array.isArray(permissions)
    ? (key: string) => (permissions as readonly string[]).includes(key)
    : (key: string) => (permissions as ReadonlySet<string>).has(key)
  return gate.some((way) => way.every(holds))
}

/** Whether a viewer holding `permissions` can open the settings page at `path`. */
export function canOpenSettingsPage(
  permissions: ReadonlySet<string> | readonly string[] | undefined,
  path: GatedSettingsPage
): boolean {
  return holdsPageGate(permissions, SETTINGS_PAGE_ACCESS[path])
}

/**
 * A settings route's gate: a viewer who cannot open `path` is sent where any
 * other permission miss in the admin goes (see assertRoutePermission).
 */
export function assertSettingsPageAccess(
  permissions: readonly string[] | undefined,
  path: GatedSettingsPage
): void {
  if (!canOpenSettingsPage(permissions, path)) {
    throw redirect(buildSigninRedirect('/admin', { error: 'not_team_member' }))
  }
}
