import type { PrincipalId, UserId } from '@quackback/ids'

/**
 * Known MCP scopes that gate tool access — single source of truth.
 *
 * Consumed by `ALL_SCOPES` (handler.ts), the OAuth provider scope list
 * (auth/index.ts), and the protected-resource metadata
 * (.well-known/oauth-protected-resource) so the advertised set never drifts.
 */
export const MCP_SCOPES = [
  'read:feedback',
  'write:feedback',
  'write:changelog',
  'read:help-center',
  'write:help-center',
  'read:tickets',
  'write:tickets',
  'manage:tickets',
  'read:contacts',
  'write:contacts',
  'read:article',
  'write:article',
  'read:chat',
  'write:chat',
  // Workspace configuration (inboxes, teams, statuses, SLA, routing, business
  // hours, segments, user attributes, portal tabs, widget profiles, settings).
  'read:config',
  'write:config',
  // Identity & administration (roles/permissions, principals, users, API keys,
  // webhooks, audit log). `manage:admin` is sensitive and opt-in (not a default
  // scope for dynamically-registered clients).
  'read:admin',
  'manage:admin',
] as const

export type McpScope = (typeof MCP_SCOPES)[number]

/**
 * Auth context resolved once in the route handler.
 * Supports both OAuth JWT and API key authentication.
 * Threaded through to all MCP write tools for attribution.
 */
export interface McpAuthContext {
  principalId: PrincipalId
  /** Null for service principals (API keys) */
  userId?: UserId
  /** Display name — always available (user.name for humans, displayName for service) */
  name: string
  /** Null for service principals */
  email?: string
  role: 'admin' | 'member' | 'user'
  authMethod: 'oauth' | 'api-key'
  /** Granted scopes. OAuth tokens have limited scopes; API keys get all. */
  scopes: McpScope[]
}
