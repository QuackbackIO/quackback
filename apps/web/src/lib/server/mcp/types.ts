import type { PrincipalId, UserId } from '@quackback/ids'

/**
 * Auth context resolved once in the route handler from API key → principal → user.
 * Threaded through to all MCP write tools for attribution.
 */
export interface McpAuthContext {
  principalId: PrincipalId
  userId: UserId
  name: string
  email: string
  role: 'admin' | 'member'
}
