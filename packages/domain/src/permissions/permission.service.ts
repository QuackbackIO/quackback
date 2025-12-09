/**
 * PermissionService - Centralized permission checking for public portal interactions
 *
 * This service handles:
 * - Resolving effective permissions (org-level with board-level overrides)
 * - Checking if users can perform interactions (voting, commenting, submissions)
 * - Team member detection
 */

import {
  getBoardSettings,
  resolvePermission,
  type PermissionLevel,
  type Board,
} from '@quackback/db/types'
import { ok, err, type Result } from '../shared/result'
import { PermissionError } from './permission.errors'
import type { InteractionType, CanInteractResult, PermissionUserContext } from './permission.types'

/**
 * Service class for permission-related operations
 */
export class PermissionService {
  /**
   * Get the effective permission level for an interaction, considering
   * both org-level and board-level settings
   */
  getEffectivePermission(orgPermission: PermissionLevel, board?: Board | null): PermissionLevel {
    if (!board) {
      return orgPermission
    }

    const boardSettings = getBoardSettings(board)
    // Map interaction type to board setting field
    return resolvePermission(orgPermission, boardSettings.voting) // This needs to be parameterized
  }

  /**
   * Get the effective permission level for a specific interaction type
   */
  getEffectivePermissionForInteraction(
    interaction: InteractionType,
    orgPermissions: {
      voting: PermissionLevel
      commenting: PermissionLevel
      submissions: PermissionLevel
    },
    board?: Board | null
  ): PermissionLevel {
    const orgLevel = orgPermissions[interaction]

    if (!board) {
      return orgLevel
    }

    const boardSettings = getBoardSettings(board)
    const boardLevel = boardSettings[interaction]
    return resolvePermission(orgLevel, boardLevel)
  }

  /**
   * Check if a user can perform an interaction based on permission level
   * and their authentication state
   *
   * @param permission - The effective permission level
   * @param user - User context (authenticated, team member status)
   * @returns Whether the action is allowed and the reason
   */
  canUserInteract(permission: PermissionLevel, user: PermissionUserContext): CanInteractResult {
    // Team members can always perform actions unless globally disabled
    if (user.isTeamMember && permission !== 'disabled') {
      return {
        allowed: true,
        reason: 'allowed',
        effectivePermission: permission,
      }
    }

    switch (permission) {
      case 'anyone':
        return {
          allowed: true,
          reason: 'allowed',
          effectivePermission: permission,
        }
      case 'authenticated':
        return {
          allowed: user.isAuthenticated,
          reason: user.isAuthenticated ? 'allowed' : 'requires_auth',
          effectivePermission: permission,
        }
      case 'disabled':
        return {
          allowed: false,
          reason: 'disabled',
          effectivePermission: permission,
        }
    }
  }

  /**
   * Full permission check - resolves effective permission and checks user access
   *
   * This is the main entry point for checking if a user can perform an action
   * on a specific board within an organization.
   */
  checkInteraction(
    interaction: InteractionType,
    orgPermissions: {
      voting: PermissionLevel
      commenting: PermissionLevel
      submissions: PermissionLevel
    },
    user: PermissionUserContext,
    board?: Board | null
  ): Result<CanInteractResult, PermissionError> {
    try {
      const effectivePermission = this.getEffectivePermissionForInteraction(
        interaction,
        orgPermissions,
        board
      )

      return ok(this.canUserInteract(effectivePermission, user))
    } catch (error) {
      return err(
        PermissionError.validationError(
          `Failed to check permission: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }
}

/**
 * Singleton instance of PermissionService
 */
export const permissionService = new PermissionService()
