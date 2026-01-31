/**
 * Member domain types
 *
 * These types are safe to import from client-side code as they have
 * no database dependencies.
 */

import type { MemberId, UserId } from '@quackback/ids'

/**
 * Team member info with user details
 */
export interface TeamMember {
  id: MemberId
  userId: UserId
  name: string | null
  email: string
  image: string | null
  role: string
  createdAt: Date
}
