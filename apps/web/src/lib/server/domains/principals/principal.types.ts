/**
 * Principal domain types
 *
 * These types are safe to import from client-side code as they have
 * no database dependencies.
 */

import type { PrincipalId, UserId } from '@quackback/ids'

/**
 * Team member info with user details
 */
export interface TeamMember {
  id: PrincipalId
  userId: UserId
  name: string | null
  email: string
  image: string | null
  role: string
  createdAt: Date
}
