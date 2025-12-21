import { eq, sql, and, inArray } from 'drizzle-orm'
import { adminDb } from '../tenant-context'
import { boards } from '../schema/boards'
import { posts } from '../schema/posts'
import { member } from '../schema/auth'
import type { WorkspaceId } from '@quackback/ids'

// ============================================================================
// Types
// ============================================================================

export interface UsageCounts {
  boards: number
  posts: number
  /** Billable seats (owner + admin roles only) */
  seats: number
}

// ============================================================================
// Usage Queries (admin - bypasses RLS for billing)
// ============================================================================

/**
 * Get usage counts for an organization.
 * Used for billing dashboard to show current usage vs plan limits.
 * Bypasses RLS since this is an admin operation for billing.
 */
export async function getWorkspaceUsageCounts(organizationId: WorkspaceId): Promise<UsageCounts> {
  // Count boards
  const [boardResult] = await adminDb
    .select({ count: sql<number>`count(*)::int` })
    .from(boards)
    .where(eq(boards.workspaceId, organizationId))

  // Count posts
  const [postResult] = await adminDb
    .select({ count: sql<number>`count(*)::int` })
    .from(posts)
    .where(eq(posts.workspaceId, organizationId))

  // Count billable seats (owner + admin only - not 'member' or 'user' roles)
  const [seatResult] = await adminDb
    .select({ count: sql<number>`count(*)::int` })
    .from(member)
    .where(and(eq(member.workspaceId, organizationId), inArray(member.role, ['owner', 'admin'])))

  return {
    boards: boardResult?.count ?? 0,
    posts: postResult?.count ?? 0,
    seats: seatResult?.count ?? 0,
  }
}
