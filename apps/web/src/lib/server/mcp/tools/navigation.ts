import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { buildAskDestinations } from '@/lib/shared/ask-destinations'
import { getFeatureFlags } from '@/lib/server/domains/settings/settings.service'
import { getCloudConfig } from '@/lib/server/domains/settings/cloud/cloud.service'
import { resolveMcpActor } from '../resolve-actor'
import type { McpAuthContext, McpScope } from '../types'
import { registerTool, requireScope, errorResult, compactJsonResult, READ_ONLY } from './helpers'

export const WORKSPACE_NAVIGATION = {
  general: {
    href: '/admin/settings/general',
    permission: PERMISSIONS.SETTINGS_MANAGE,
    scope: 'read:settings',
  },
  portal: {
    href: '/admin/settings/portal',
    permission: PERMISSIONS.SETTINGS_BRANDING,
    scope: 'read:settings',
  },
  billing: {
    href: '/admin/settings/billing',
    permission: PERMISSIONS.BILLING_MANAGE,
    scope: 'read:settings',
  },
  authentication: {
    href: '/admin/settings/security/authentication',
    permission: PERMISSIONS.AUTH_MANAGE,
    scope: 'read:settings',
  },
  domains: {
    href: '/admin/settings/domains',
    permission: PERMISSIONS.SETTINGS_CUSTOM_DOMAIN,
    scope: 'read:settings',
  },
  members: {
    href: '/admin/settings/members',
    permission: PERMISSIONS.MEMBER_MANAGE,
    scope: 'read:settings',
  },
  api_keys: {
    href: '/admin/settings/developers',
    permission: PERMISSIONS.API_KEY_MANAGE,
    scope: 'read:settings',
  },
  integrations: {
    href: '/admin/settings/integrations',
    permission: PERMISSIONS.INTEGRATION_MANAGE,
    scope: 'read:settings',
  },
  install_messenger: {
    href: '/admin/settings/widget/install',
    permission: PERMISSIONS.SETTINGS_MANAGE,
    scope: 'read:settings',
  },
  boards: {
    href: '/admin/settings/boards',
    permission: PERMISSIONS.BOARD_MANAGE,
    scope: 'read:feedback',
  },
  feedback: {
    href: '/admin/feedback',
    permission: PERMISSIONS.POST_VIEW_PRIVATE,
    scope: 'read:feedback',
  },
  conversations: {
    href: '/admin/inbox',
    permission: PERMISSIONS.CONVERSATION_VIEW,
    scope: 'read:chat',
  },
  articles: {
    href: '/admin/help-center',
    permission: PERMISSIONS.HELP_CENTER_MANAGE,
    scope: 'read:article',
  },
  changelog: {
    href: '/admin/changelog',
    permission: PERMISSIONS.CHANGELOG_MANAGE,
    scope: 'read:feedback',
  },
  status: {
    href: '/admin/status',
    permission: PERMISSIONS.STATUS_PAGE_MANAGE,
    scope: 'read:settings',
  },
} as const satisfies Record<string, { href: string; permission: PermissionKey; scope: McpScope }>

export type WorkspaceNavigationDestination = keyof typeof WORKSPACE_NAVIGATION
export const WORKSPACE_NAVIGATION_DESTINATIONS = Object.keys(WORKSPACE_NAVIGATION) as [
  WorkspaceNavigationDestination,
  ...WorkspaceNavigationDestination[],
]

export const workspaceNavigationInputSchema = z
  .object({
    destination: z
      .enum(WORKSPACE_NAVIGATION_DESTINATIONS)
      .describe('The existing workspace page to open.'),
  })
  .strict()

export function registerNavigationTools(server: McpServer, auth: McpAuthContext) {
  registerTool<{ destination: WorkspaceNavigationDestination }>(server, auth, {
    name: 'navigate_workspace',
    description: `Return an allowed workspace deep link without changing anything. Use this for operator-managed workspace names, billing or plans, authentication or SSO, domains, members or roles, API keys, integration OAuth, installing a site snippet, creating a board, portal header customization, and every delete request. These areas cannot be changed from chat. Never invent a URL. A delete request opens its product page for a person to review.
Examples:
{"destination":"members"}
{"destination":"install_messenger"}
{"destination":"authentication"}`,
    schema: workspaceNavigationInputSchema.shape,
    annotations: READ_ONLY,
    teamOnly: true,
    handler: async ({ destination }) => {
      const entry = WORKSPACE_NAVIGATION[destination]
      const scopeDenied = requireScope(auth, entry.scope)
      if (scopeDenied) return scopeDenied
      const actor = await resolveMcpActor(auth, entry.scope)
      if (!actor.permissions?.has(entry.permission)) {
        return errorResult(
          new Error(
            `Ask a workspace owner or an admin with ${entry.permission} permission to open this page.`
          )
        )
      }
      const [featureFlags, commercial] = await Promise.all([getFeatureFlags(), getCloudConfig()])
      const page = buildAskDestinations({
        permissions: actor.permissions,
        featureFlags,
        billingEnabled:
          commercial.enabled && (commercial.canUpgrade || commercial.canManageBilling),
        domainsEnabled: commercial.enabled,
      }).find((item) => item.href === entry.href)
      if (!page) return errorResult(new Error('This page is unavailable for this workspace.'))
      return compactJsonResult({
        navigation: { href: page.href, label: page.defaultMessage, messageId: page.messageId },
        reason: 'continue_in_settings',
      })
    },
  })
}
