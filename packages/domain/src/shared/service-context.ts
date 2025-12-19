/**
 * Service Context Types
 *
 * This module defines the core types for the service layer execution context.
 * ServiceContext captures all necessary information about the authenticated user
 * and their workspace for service operations.
 */

import type { MemberId, WorkspaceId, UserId } from '@quackback/ids'

/**
 * Execution context for service layer operations.
 * Contains authenticated user and workspace information.
 *
 * All authenticated users have member records with unified roles:
 * - owner/admin/member: Team members with admin dashboard access
 * - user: Portal users with public portal access only
 */
export interface ServiceContext {
  /** Workspace ID for multi-tenant isolation (TypeID format: workspace_xxx) */
  workspaceId: WorkspaceId
  /** User ID of the authenticated user (TypeID format: user_xxx) */
  userId: UserId
  /** Member ID - all authenticated users have member records now (TypeID format: member_xxx) */
  memberId: MemberId
  /** Member's role in the workspace (unified: owner/admin/member/user) */
  memberRole: 'owner' | 'admin' | 'member' | 'user'
  /** User's display name */
  userName: string
  /** User's email address */
  userEmail: string
  /** Optional identifier for anonymous users (unauthenticated) */
  userIdentifier?: string
}

/**
 * Auth validation result structure used to build ServiceContext.
 * This matches the shape returned by auth validation helpers.
 *
 * All authenticated users have member records in the unified model.
 */
export interface AuthValidation {
  workspace: {
    id: WorkspaceId
  }
  user: {
    id: UserId
    name: string | null
    email: string
  }
  member: {
    id: MemberId
    role: string
  }
}

/**
 * Builds a ServiceContext from auth validation result.
 *
 * @param validation - Auth validation result containing workspace, user, and member data
 * @returns ServiceContext ready for service layer operations
 */
export function buildServiceContext(validation: AuthValidation): ServiceContext {
  return {
    workspaceId: validation.workspace.id,
    userId: validation.user.id,
    memberId: validation.member.id,
    memberRole: validation.member.role as 'owner' | 'admin' | 'member' | 'user',
    userName: validation.user.name || validation.user.email,
    userEmail: validation.user.email,
  }
}

/**
 * Pagination parameters for list operations.
 */
export interface PaginationParams {
  /** Maximum number of items to return */
  limit?: number
  /** Number of items to skip (offset-based pagination) */
  offset?: number
  /** Cursor for cursor-based pagination */
  cursor?: string
}

/**
 * Paginated result wrapper.
 * Contains items along with pagination metadata.
 */
export interface PaginatedResult<T> {
  /** Array of items for the current page */
  items: T[]
  /** Total count of items across all pages */
  total: number
  /** Whether more items exist after this page */
  hasMore: boolean
  /** Cursor for fetching the next page (cursor-based pagination) */
  nextCursor?: string
}
