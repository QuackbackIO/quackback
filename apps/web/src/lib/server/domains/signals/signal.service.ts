/**
 * AI Signal CRUD service.
 *
 * Handles creating, resolving, expiring, and querying AI signals.
 * Signals are the unified surfacing layer for all AI-generated insights.
 */

import { db, aiSignals, eq, and, inArray, desc, sql, count } from '@/lib/server/db'
import type { PostId, PrincipalId, AiSignalId } from '@quackback/ids'

// ============================================
// Types
// ============================================

export type AiSignalType = 'duplicate' | 'sentiment' | 'categorize' | 'trend' | 'response_draft'
export type AiSignalSeverity = 'info' | 'warning' | 'urgent'
export type AiSignalStatus = 'pending' | 'accepted' | 'dismissed' | 'expired'

export interface CreateSignalOpts {
  type: AiSignalType
  severity?: AiSignalSeverity
  postId: PostId
  payload: Record<string, unknown>
}

export interface SignalSummary {
  type: AiSignalType
  count: number
}

export interface PostSignalCounts {
  postId: PostId
  type: AiSignalType
  severity: AiSignalSeverity
  count: number
}

// ============================================
// Create
// ============================================

/**
 * Create a new AI signal for a post.
 */
export async function createSignal(opts: CreateSignalOpts): Promise<AiSignalId | null> {
  console.log(
    `[domain:signals] createSignal: type=${opts.type} postId=${opts.postId} severity=${opts.severity ?? 'info'}`
  )
  const [row] = await db
    .insert(aiSignals)
    .values({
      type: opts.type,
      severity: opts.severity ?? 'info',
      postId: opts.postId,
      payload: opts.payload,
    })
    .returning({ id: aiSignals.id })

  return (row?.id as AiSignalId) ?? null
}

// ============================================
// Resolve
// ============================================

/**
 * Resolve a signal (accept or dismiss).
 */
export async function resolveSignal(
  id: AiSignalId,
  status: 'accepted' | 'dismissed',
  principalId: PrincipalId
): Promise<void> {
  console.log(`[domain:signals] resolveSignal: id=${id} status=${status}`)
  await db
    .update(aiSignals)
    .set({
      status,
      resolvedAt: new Date(),
      resolvedByPrincipalId: principalId,
      updatedAt: new Date(),
    })
    .where(and(eq(aiSignals.id, id), eq(aiSignals.status, 'pending')))
}

/**
 * Resolve all pending signals of a given type for a post.
 * Used when an action (like merge) should clear related signals.
 */
export async function resolveSignalsForPost(
  postId: PostId,
  type: AiSignalType,
  status: 'accepted' | 'dismissed',
  principalId: PrincipalId
): Promise<number> {
  console.log(
    `[domain:signals] resolveSignalsForPost: postId=${postId} type=${type} status=${status}`
  )
  const result = await db
    .update(aiSignals)
    .set({
      status,
      resolvedAt: new Date(),
      resolvedByPrincipalId: principalId,
      updatedAt: new Date(),
    })
    .where(
      and(eq(aiSignals.postId, postId), eq(aiSignals.type, type), eq(aiSignals.status, 'pending'))
    )
    .returning({ id: aiSignals.id })

  return result.length
}

/**
 * Resolve all pending duplicate signals involving either of two posts.
 * Used after a merge to clear all related duplicate signals.
 */
export async function resolveDuplicateSignalsForPosts(
  postIds: PostId[],
  status: 'accepted' | 'dismissed',
  principalId: PrincipalId
): Promise<number> {
  if (postIds.length === 0) return 0

  console.log(
    `[domain:signals] resolveDuplicateSignalsForPosts: postIds=${postIds.join(',')} status=${status}`
  )
  const result = await db
    .update(aiSignals)
    .set({
      status,
      resolvedAt: new Date(),
      resolvedByPrincipalId: principalId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(aiSignals.type, 'duplicate'),
        eq(aiSignals.status, 'pending'),
        inArray(aiSignals.postId, postIds)
      )
    )
    .returning({ id: aiSignals.id })

  return result.length
}

// ============================================
// Expire
// ============================================

/**
 * Expire stale pending signals (older than 30 days).
 */
export async function expireStaleSignals(): Promise<number> {
  console.log(`[domain:signals] expireStaleSignals`)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const result = await db
    .update(aiSignals)
    .set({
      status: 'expired',
      updatedAt: new Date(),
    })
    .where(
      and(eq(aiSignals.status, 'pending'), sql`${aiSignals.createdAt} < ${thirtyDaysAgo}`)
    )
    .returning({ id: aiSignals.id })

  return result.length
}

// ============================================
// Query
// ============================================

/**
 * Get pending signal counts by type (for the signal summary bar).
 */
export async function getSignalSummary(): Promise<SignalSummary[]> {
  const rows = await db
    .select({
      type: aiSignals.type,
      count: count(),
    })
    .from(aiSignals)
    .where(eq(aiSignals.status, 'pending'))
    .groupBy(aiSignals.type)

  return rows as SignalSummary[]
}

/**
 * Get signal counts per post for a batch of post IDs (for L1 badges).
 * Returns grouped counts by postId, type, and severity.
 */
export async function getSignalCountsForPosts(postIds: PostId[]): Promise<PostSignalCounts[]> {
  if (postIds.length === 0) return []

  const rows = await db
    .select({
      postId: aiSignals.postId,
      type: aiSignals.type,
      severity: aiSignals.severity,
      count: count(),
    })
    .from(aiSignals)
    .where(and(eq(aiSignals.status, 'pending'), inArray(aiSignals.postId, postIds)))
    .groupBy(aiSignals.postId, aiSignals.type, aiSignals.severity)

  return rows as PostSignalCounts[]
}

export interface AiSignalRow {
  id: string
  type: string
  severity: string
  postId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>
  status: string
  createdAt: Date
}

/**
 * Get all pending signals for a single post (for L3 detail panel).
 */
export async function getSignalsForPost(postId: PostId): Promise<AiSignalRow[]> {
  const rows = await db
    .select({
      id: aiSignals.id,
      type: aiSignals.type,
      severity: aiSignals.severity,
      postId: aiSignals.postId,
      payload: aiSignals.payload,
      status: aiSignals.status,
      createdAt: aiSignals.createdAt,
    })
    .from(aiSignals)
    .where(and(eq(aiSignals.postId, postId), eq(aiSignals.status, 'pending')))
    .orderBy(desc(aiSignals.createdAt))

  return rows as AiSignalRow[]
}
