/**
 * Types for the permission service
 */

import type { PermissionLevel } from '@quackback/db/types'

/**
 * Types of interactions that can be permission-controlled
 */
export type InteractionType = 'voting' | 'commenting' | 'submissions'

/**
 * Result of checking if a user can perform an action
 */
export interface CanInteractResult {
  allowed: boolean
  reason: 'allowed' | 'disabled' | 'requires_auth'
  effectivePermission: PermissionLevel
}

/**
 * User context for permission checks (minimal info needed)
 */
export interface PermissionUserContext {
  isAuthenticated: boolean
  isTeamMember: boolean
}
