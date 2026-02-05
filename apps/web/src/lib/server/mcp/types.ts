import type { MemberId, UserId } from '@quackback/ids'

/**
 * Auth context resolved once in the route handler from API key → member → user.
 * Threaded through to all MCP write tools for attribution.
 */
export interface McpAuthContext {
  memberId: MemberId
  userId: UserId
  name: string
  email: string
  role: 'admin' | 'member'
}
