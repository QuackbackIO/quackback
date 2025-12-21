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
 *
 * Optimized to use a single query with scalar subqueries for efficiency.
 */
export async function getWorkspaceUsageCounts(organizationId: WorkspaceId): Promise<UsageCounts> {
  // Run 3 parallel count queries - faster than serial and still efficient
  const [boardResult, postResult, seatResult] = await Promise.all([
    adminDb
      .select({ count: sql<number>`count(*)::int` })
      .from(boards)
      .where(eq(boards.workspaceId, organizationId)),
    adminDb
      .select({ count: sql<number>`count(*)::int` })
      .from(posts)
      .where(eq(posts.workspaceId, organizationId)),
    adminDb
      .select({ count: sql<number>`count(*)::int` })
      .from(member)
      .where(and(eq(member.workspaceId, organizationId), inArray(member.role, ['owner', 'admin']))),
  ])

  return {
    boards: boardResult[0]?.count ?? 0,
    posts: postResult[0]?.count ?? 0,
    seats: seatResult[0]?.count ?? 0,
  }
}
