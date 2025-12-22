import { sql, inArray } from 'drizzle-orm'
import { db } from '../client'
import { boards } from '../schema/boards'
import { posts } from '../schema/posts'
import { member } from '../schema/auth'

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
// Usage Queries
// ============================================================================

/**
 * Get usage counts for the application.
 * Used for dashboard to show current usage.
 *
 * Optimized to use parallel queries for efficiency.
 */
export async function getUsageCounts(): Promise<UsageCounts> {
  // Run 3 parallel count queries - faster than serial and still efficient
  const [boardResult, postResult, seatResult] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(boards),
    db.select({ count: sql<number>`count(*)::int` }).from(posts),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(member)
      .where(inArray(member.role, ['owner', 'admin'])),
  ])

  return {
    boards: boardResult[0]?.count ?? 0,
    posts: postResult[0]?.count ?? 0,
    seats: seatResult[0]?.count ?? 0,
  }
}

// Backwards compatibility alias
export const getWorkspaceUsageCounts = getUsageCounts
