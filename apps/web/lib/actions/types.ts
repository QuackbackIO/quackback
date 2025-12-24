import type { Feature } from '@quackback/domain'
import type { UserId, MemberId } from '@quackback/ids'

/**
 * Unified role type for all users (team + portal)
 * - owner: Full administrative access
 * - admin: Administrative access
 * - member: Team member access
 * - user: Portal user access (public portal only)
 */
export type Role = 'owner' | 'admin' | 'member' | 'user'

/**
 * Discriminated union for action results.
 * All server actions return this type for consistent error handling.
 */
export type ActionResult<T> = { success: true; data: T } | { success: false; error: ActionError }

/**
 * Error codes for server actions.
 * Maps to HTTP status codes for client-side handling.
 */
export type ActionErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYMENT_REQUIRED'
  | 'INTERNAL_ERROR'

/**
 * Structured error response for client consumption.
 */
export interface ActionError {
  code: ActionErrorCode
  message: string
  /** HTTP-equivalent status for client-side handling */
  status: 400 | 401 | 402 | 403 | 404 | 409 | 500
  /** For 402 Payment Required - indicates required tier */
  requiredTier?: string
  /** For 402 - URL to upgrade */
  upgradeUrl?: string
  /** Field-level validation errors for forms */
  fieldErrors?: Record<string, string[]>
}

/**
 * Context available inside action handlers.
 * Similar to ApiHandlerContext but for server actions.
 */
export interface ActionContext {
  settings: {
    id: string
    slug: string
    name: string
  }
  user: {
    id: UserId
    email: string
    name: string
  }
  member: {
    id: MemberId
    role: Role
  }
}

/**
 * Options for the action wrapper.
 */
export interface ActionOptions {
  /**
   * Required roles for this action. If not specified, any authenticated member can access.
   */
  roles?: Role[]
  /**
   * Required feature for this action. If specified, checks subscription tier access.
   * OSS (self-hosted) editions automatically have access to all features.
   */
  feature?: Feature
}

/**
 * Helper to create success results.
 *
 * @example
 * return actionOk(createdTag)
 */
export function actionOk<T>(data: T): ActionResult<T> {
  return { success: true, data }
}

/**
 * Helper to create error results.
 *
 * @example
 * return actionErr({ code: 'NOT_FOUND', message: 'Tag not found', status: 404 })
 */
export function actionErr<T = never>(error: ActionError): ActionResult<T> {
  return { success: false, error }
}

/**
 * Map domain service error codes to action errors.
 *
 * @example
 * if (!result.success) return actionErr(mapDomainError(result.error))
 */
export function mapDomainError(error: { code: string; message: string }): ActionError {
  switch (error.code) {
    case 'TAG_NOT_FOUND':
    case 'STATUS_NOT_FOUND':
    case 'POST_NOT_FOUND':
    case 'BOARD_NOT_FOUND':
    case 'COMMENT_NOT_FOUND':
    case 'ROADMAP_NOT_FOUND':
    case 'MEMBER_NOT_FOUND':
    case 'USER_NOT_FOUND':
    case 'INVITATION_NOT_FOUND':
      return { code: 'NOT_FOUND', message: error.message, status: 404 }
    case 'DUPLICATE_NAME':
    case 'DUPLICATE_SLUG':
    case 'DUPLICATE_EMAIL':
      return { code: 'CONFLICT', message: error.message, status: 409 }
    case 'UNAUTHORIZED':
    case 'PERMISSION_DENIED':
      return { code: 'FORBIDDEN', message: error.message, status: 403 }
    case 'VALIDATION_ERROR':
    case 'INVALID_INPUT':
      return { code: 'VALIDATION_ERROR', message: error.message, status: 400 }
    default:
      console.error('Unmapped domain error:', error)
      return { code: 'INTERNAL_ERROR', message: 'Internal server error', status: 500 }
  }
}
