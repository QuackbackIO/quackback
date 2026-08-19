import type { PrincipalId, UserId } from '@quackback/ids'
import type { Role } from '@/lib/shared/roles'
import type { ApiKeyScope } from '@/lib/server/domains/api-keys/api-key-scopes'

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
  principalId: PrincipalId
  /** Null for service principals (API keys) */
  userId?: UserId
  /** Display name — always available (user.name for humans, displayName for service) */
  name: string
  /** Null for service principals */
  email?: string
  role: Role
  authMethod: 'oauth' | 'api-key'
  /**
   * Granted scopes. OAuth tokens carry the grant's scopes; API keys carry
   * their stored scopes, or every scope for legacy keys with none stored.
   */
  scopes: McpScope[]
}
