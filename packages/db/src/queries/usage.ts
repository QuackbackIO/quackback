import { eq, sql, and, ne } from 'drizzle-orm'
import { adminDb } from '../tenant-context'
import { boards } from '../schema/boards'
import { posts } from '../schema/posts'
import { member } from '../schema/auth'
import type { OrgId } from '@quackback/ids'

// ============================================================================
// Types
// ============================================================================

export interface UsageCounts {
  boards: number
  posts: number
  teamMembers: number
}

// ============================================================================
// Usage Queries (admin - bypasses RLS for billing)
// ============================================================================

/**
 * Get usage counts for an organization.
 * Used for billing dashboard to show current usage vs plan limits.
 * Bypasses RLS since this is an admin operation for billing.
 */
export async function getOrganizationUsageCounts(organizationId: OrgId): Promise<UsageCounts> {
  // Count boards
  const [boardResult] = await adminDb
    .select({ count: sql<number>`count(*)::int` })
    .from(boards)
    .where(eq(boards.organizationId, organizationId))

  // Count posts
  const [postResult] = await adminDb
    .select({ count: sql<number>`count(*)::int` })
    .from(posts)
    .where(eq(posts.organizationId, organizationId))

  // Count team members (exclude 'user' role - those are portal users, not team members)
  const [memberResult] = await adminDb
    .select({ count: sql<number>`count(*)::int` })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), ne(member.role, 'user')))

  return {
    boards: boardResult?.count ?? 0,
    posts: postResult?.count ?? 0,
    teamMembers: memberResult?.count ?? 0,
  }
}
