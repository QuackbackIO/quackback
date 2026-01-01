/**
 * Member domain types
 *
 * These types are safe to import from client-side code as they have
 * no database dependencies.
 */

import type { UserId } from '@quackback/ids'

export type MemberError = {
  code: 'MEMBER_NOT_FOUND' | 'DATABASE_ERROR'
  message: string
}

/**
 * Team member info with user details
 */
export interface TeamMember {
  id: UserId
  name: string | null
  email: string
  image: string | null
}
