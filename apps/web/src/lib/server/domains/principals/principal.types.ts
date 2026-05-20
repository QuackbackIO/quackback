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
  email: string | null
  image: string | null
  role: string
  createdAt: Date
  /**
   * Most recent successful sign-in (max of session.created_at for the
   * user). Null when the user has never signed in or all their
   * sessions have been pruned. Surfaced in the admin team list so
   * operators can spot stale accounts at a glance.
   */
  lastSignInAt: Date | null
}
