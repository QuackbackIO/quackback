import type { PrincipalId, UserId } from '@quackback/ids'

/** Known MCP scopes that gate tool access. */
export type McpScope = 'read:feedback' | 'write:feedback' | 'write:changelog'

/**
 * Auth context resolved once in the route handler.
 * Supports both OAuth JWT and API key authentication.
 * Threaded through to all MCP write tools for attribution.
 */
export interface McpAuthContext {
  principalId: PrincipalId
  userId: UserId
  name: string
  email: string
  role: 'admin' | 'member' | 'user'
  authMethod: 'oauth' | 'api-key'
  /** Granted scopes. OAuth tokens have limited scopes; API keys get all. */
  scopes: McpScope[]
}
