import type { PrincipalId, UserId } from '@quackback/ids'
import type { Role } from '@/lib/shared/roles'
import type { PermissionKey } from '@/lib/shared/permissions'
import type { ApiKeyScope } from '@/lib/server/domains/api-keys/api-key-scopes'
import type { AuditAttribution } from '@/lib/server/audit/attribution'

/**
 * Known MCP scopes that gate tool access — the same capability vocabulary API
 * keys store and the REST API enforces (see domains/api-keys/api-key-scopes.ts).
 */
export type McpScope = ApiKeyScope

/**
 * Auth context resolved once in the route handler.
 * Supports both OAuth JWT and API key authentication.
 * Threaded through to all MCP write tools for attribution.
 */
export interface McpAuthContext {
  /** Server-bound private workspace conversation, never supplied as tool arguments. */
  workspaceThreadKey?: string
  /**
   * Ceiling on the caller's permissions, carried into every MCP policy actor.
   * API keys set their resolved authority here (the key's role preset
   * intersected with its creator's current permissions).
   */
  permissions?: ReadonlySet<PermissionKey>
  principalId: PrincipalId
  /**
   * For a personal API key, the creator whose row scope the key follows. Every
   * support-tool actor built from this context carries it, so ticket and
   * conversation reads show only what that teammate can see.
   */
  scopePrincipalId?: PrincipalId
  /** Null for service principals (API keys) */
  userId?: UserId
  /** Display name — always available (user.name for humans, displayName for service) */
  name: string
  /** Null for service principals */
  email?: string
  role: Role
  authMethod: 'oauth' | 'api-key'
  /**
   * The credential the request arrived through: the API key id, or the OAuth
   * client id. Recorded on a request for approval, which that credential can
   * then never decide.
   */
  credentialId?: string
  /** The name that credential's client goes by (an API key's name). */
  clientName?: string
  /**
   * Granted scopes. OAuth tokens carry the grant's scopes; API keys carry
   * their stored scopes, or every scope for legacy keys with none stored.
   */
  scopes: McpScope[]
  /**
   * The credential this request's changes are attributed to: the OAuth client
   * or the API key. Set by the HTTP handler; absent for in-process callers,
   * which run under their own boundary.
   */
  auditAttribution?: AuditAttribution
}
