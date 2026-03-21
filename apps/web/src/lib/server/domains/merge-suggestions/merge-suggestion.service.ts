/**
 * Merge suggestion CRUD service.
 *
 * Handles creating, accepting, dismissing, and querying merge suggestions.
 */

import {
  db,
  mergeSuggestions,
  posts,
  boards,
  postStatuses,
  eq,
  and,
  or,
  inArray,
  desc,
  sql,
  count,
} from '@/lib/server/db'
import { mergePost } from '@/lib/server/domains/posts/post.merge'
import { NotFoundError } from '@/lib/shared/errors'
import type { PostId, PrincipalId, MergeSuggestionId } from '@quackback/ids'

export interface MergeSuggestionPostView {
  id: string
  title: string
  content: string | null
  voteCount: number
  commentCount: number
  createdAt: Date
  boardName: string | null
  statusName: string | null
  statusColor: string | null
}

export interface CreateMergeSuggestionOpts {
  sourcePostId: PostId
  targetPostId: PostId
  vectorScore: number
  ftsScore: number
  hybridScore: number
  llmConfidence: number
  llmReasoning: string
  llmModel: string
}

export interface MergeSuggestionView {
  id: MergeSuggestionId
  sourcePostId: PostId
  targetPostId: PostId
  status: string
  hybridScore: number
  llmConfidence: number
  llmReasoning: string | null
  createdAt: Date
  // Joined fields
  sourcePostTitle: string
  targetPostTitle: string
  sourcePostVoteCount: number
  targetPostVoteCount: number
  sourcePostStatusName: string | null
  sourcePostStatusColor: string | null
  targetPostStatusName: string | null
  targetPostStatusColor: string | null
}

/**
 * Create a merge suggestion. Uses onConflictDoNothing for the partial unique index.
 */
export async function createMergeSuggestion(opts: CreateMergeSuggestionOpts): Promise<void> {
  console.log(
    `[domain:merge-suggestions] createMergeSuggestion: sourcePostId=${opts.sourcePostId} targetPostId=${opts.targetPostId} hybridScore=${opts.hybridScore}`
  )
  await db
    .insert(mergeSuggestions)
    .values({
      sourcePostId: opts.sourcePostId,
      targetPostId: opts.targetPostId,
      vectorScore: opts.vectorScore,
      ftsScore: opts.ftsScore,
      hybridScore: opts.hybridScore,
      llmConfidence: opts.llmConfidence,
      llmReasoning: opts.llmReasoning,
      llmModel: opts.llmModel,
    })
    .onConflictDoNothing()
}

/**
 * Accept a merge suggestion — performs the actual post merge and marks suggestion accepted.
 */
export async function acceptMergeSuggestion(
  id: MergeSuggestionId,
  principalId: PrincipalId,
  opts?: { swapDirection?: boolean }
): Promise<void> {
  console.log(
    `[domain:merge-suggestions] acceptMergeSuggestion: id=${id} principalId=${principalId} swapDirection=${opts?.swapDirection ?? false}`
  )
  const suggestion = await db.query.mergeSuggestions.findFirst({
    where: (s, { eq }) => eq(s.id, id),
  })

  if (!suggestion || suggestion.status !== 'pending') {
    throw new NotFoundError(
      'SUGGESTION_NOT_FOUND',
      'Merge suggestion not found or already resolved'
    )
  }

  // Perform the actual merge (swap source/target if user toggled direction)
  const duplicateId = opts?.swapDirection ? suggestion.targetPostId : suggestion.sourcePostId
  const canonicalId = opts?.swapDirection ? suggestion.sourcePostId : suggestion.targetPostId
  await mergePost(duplicateId, canonicalId, principalId)

  // Mark suggestion as accepted
  await db
    .update(mergeSuggestions)
    .set({
      status: 'accepted',
      resolvedAt: new Date(),
      resolvedByPrincipalId: principalId,
      updatedAt: new Date(),
    })
    .where(eq(mergeSuggestions.id, id))

  // Dismiss any other pending suggestions involving either post
  await db
    .update(mergeSuggestions)
    .set({
      status: 'dismissed',
      resolvedAt: new Date(),
      resolvedByPrincipalId: principalId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mergeSuggestions.status, 'pending'),
        or(
          eq(mergeSuggestions.sourcePostId, suggestion.sourcePostId),
          eq(mergeSuggestions.targetPostId, suggestion.sourcePostId),
          eq(mergeSuggestions.sourcePostId, suggestion.targetPostId),
          eq(mergeSuggestions.targetPostId, suggestion.targetPostId)
        )
      )
    )
}

/**
 * Dismiss a merge suggestion.
 */
export async function dismissMergeSuggestion(
  id: MergeSuggestionId,
  principalId: PrincipalId
): Promise<void> {
  console.log(
    `[domain:merge-suggestions] dismissMergeSuggestion: id=${id} principalId=${principalId}`
  )
  await db
    .update(mergeSuggestions)
    .set({
      status: 'dismissed',
      resolvedAt: new Date(),
      resolvedByPrincipalId: principalId,
      updatedAt: new Date(),
    })
    .where(and(eq(mergeSuggestions.id, id), eq(mergeSuggestions.status, 'pending')))
}

/**
 * Restore a dismissed merge suggestion back to pending.
 */
export async function restoreMergeSuggestion(
  id: MergeSuggestionId,
  principalId: PrincipalId
): Promise<void> {
  console.log(
    `[domain:merge-suggestions] restoreMergeSuggestion: id=${id} principalId=${principalId}`
  )
  await db
    .update(mergeSuggestions)
    .set({
      status: 'pending',
      resolvedAt: null,
      resolvedByPrincipalId: null,
      updatedAt: new Date(),
    })
    .where(and(eq(mergeSuggestions.id, id), eq(mergeSuggestions.status, 'dismissed')))
}

/**
 * Get pending merge suggestions for a post (where the post is source OR target).
 */
export async function getPendingSuggestionsForPost(postId: PostId): Promise<MergeSuggestionView[]> {
  console.log(`[domain:merge-suggestions] getPendingSuggestionsForPost: postId=${postId}`)
  const sourcePostsAlias = db
    .select({
      id: posts.id,
      title: posts.title,
      voteCount: posts.voteCount,
      statusId: posts.statusId,
    })
    .from(posts)
    .as('source_posts')

  const targetPostsAlias = db
    .select({
      id: posts.id,
      title: posts.title,
      voteCount: posts.voteCount,
      statusId: posts.statusId,
    })
    .from(posts)
    .as('target_posts')

  const sourceStatusAlias = db
    .select({ id: postStatuses.id, name: postStatuses.name, color: postStatuses.color })
    .from(postStatuses)
    .as('source_status')

  const targetStatusAlias = db
    .select({ id: postStatuses.id, name: postStatuses.name, color: postStatuses.color })
    .from(postStatuses)
    .as('target_status')

  const rows = await db
    .select({
      id: mergeSuggestions.id,
      sourcePostId: mergeSuggestions.sourcePostId,
      targetPostId: mergeSuggestions.targetPostId,
      status: mergeSuggestions.status,
      hybridScore: mergeSuggestions.hybridScore,
      llmConfidence: mergeSuggestions.llmConfidence,
      llmReasoning: mergeSuggestions.llmReasoning,
      createdAt: mergeSuggestions.createdAt,
      sourcePostTitle: sourcePostsAlias.title,
      targetPostTitle: targetPostsAlias.title,
      sourcePostVoteCount: sourcePostsAlias.voteCount,
      targetPostVoteCount: targetPostsAlias.voteCount,
      sourcePostStatusName: sourceStatusAlias.name,
      sourcePostStatusColor: sourceStatusAlias.color,
      targetPostStatusName: targetStatusAlias.name,
      targetPostStatusColor: targetStatusAlias.color,
    })
    .from(mergeSuggestions)
    .innerJoin(sourcePostsAlias, eq(mergeSuggestions.sourcePostId, sourcePostsAlias.id))
    .innerJoin(targetPostsAlias, eq(mergeSuggestions.targetPostId, targetPostsAlias.id))
    .leftJoin(sourceStatusAlias, eq(sourcePostsAlias.statusId, sourceStatusAlias.id))
    .leftJoin(targetStatusAlias, eq(targetPostsAlias.statusId, targetStatusAlias.id))
    .where(
      and(
        eq(mergeSuggestions.status, 'pending'),
        or(eq(mergeSuggestions.sourcePostId, postId), eq(mergeSuggestions.targetPostId, postId))
      )
    )
    .orderBy(mergeSuggestions.createdAt)

  return rows as MergeSuggestionView[]
}

/**
 * Get all pending merge suggestions with joined post data, for the suggestions page.
 */
export async function getPendingMergeSuggestions(opts: {
  sort?: 'newest' | 'relevance'
  limit?: number
}): Promise<{
  items: Array<{
    id: string
    status: string
    hybridScore: number
    llmConfidence: number
    llmReasoning: string | null
    createdAt: Date
    updatedAt: Date
    sourcePost: MergeSuggestionPostView
    targetPost: MergeSuggestionPostView
  }>
  total: number
}> {
  console.log(
    `[domain:merge-suggestions] getPendingMergeSuggestions: sort=${opts.sort ?? 'newest'} limit=${opts.limit ?? 50}`
  )
  // Step 1: Fetch count + merge suggestion rows in parallel
  const orderBy =
    opts.sort === 'relevance'
      ? [desc(mergeSuggestions.hybridScore), desc(mergeSuggestions.createdAt)]
      : [desc(mergeSuggestions.createdAt)]

  const [countRows, rows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(mergeSuggestions)
      .where(eq(mergeSuggestions.status, 'pending')),
    db
      .select()
      .from(mergeSuggestions)
      .where(eq(mergeSuggestions.status, 'pending'))
      .orderBy(...orderBy)
      .limit(opts.limit ?? 50),
  ])

  const countResult = countRows[0]

  if (rows.length === 0) {
    return { items: [], total: Number(countResult?.count ?? 0) }
  }

  // Step 2: Batch-fetch all referenced posts with board + status info
  const allPostIds = [...new Set(rows.flatMap((r) => [r.sourcePostId, r.targetPostId]))] as PostId[]

  const postRows = await db
    .select({
      id: posts.id,
      title: posts.title,
      content: posts.content,
      voteCount: posts.voteCount,
      commentCount: posts.commentCount,
      createdAt: posts.createdAt,
      boardName: boards.name,
      statusName: postStatuses.name,
      statusColor: postStatuses.color,
    })
    .from(posts)
    .leftJoin(boards, eq(posts.boardId, boards.id))
    .leftJoin(postStatuses, eq(posts.statusId, postStatuses.id))
    .where(inArray(posts.id, allPostIds))

  const postMap = new Map(postRows.map((p) => [p.id, p]))

  const emptyPost: MergeSuggestionPostView = {
    id: '',
    title: 'Unknown post',
    content: null,
    voteCount: 0,
    commentCount: 0,
    createdAt: new Date(),
    boardName: null,
    statusName: null,
    statusColor: null,
  }

  return {
    items: rows.map((r) => ({
      id: r.id,
      status: r.status,
      hybridScore: r.hybridScore,
      llmConfidence: r.llmConfidence,
      llmReasoning: r.llmReasoning,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      sourcePost: postMap.get(r.sourcePostId) ?? emptyPost,
      targetPost: postMap.get(r.targetPostId) ?? emptyPost,
    })),
    total: Number(countResult?.count ?? 0),
  }
}

/**
 * Expire stale pending suggestions (older than 30 days).
 */
export async function expireStaleMergeSuggestions(): Promise<number> {
  console.log(`[domain:merge-suggestions] expireStaleMergeSuggestions`)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const result = await db
    .update(mergeSuggestions)
    .set({
      status: 'expired',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mergeSuggestions.status, 'pending'),
        sql`${mergeSuggestions.createdAt} < ${thirtyDaysAgo}`
      )
    )
    .returning({ id: mergeSuggestions.id })

  return result.length
}

/**
 * Get total count of pending merge suggestions (for summary bar).
 */
export async function getPendingMergeSuggestionSummary(): Promise<{ count: number }> {
  const [row] = await db
    .select({ count: count() })
    .from(mergeSuggestions)
    .where(eq(mergeSuggestions.status, 'pending'))

  return { count: Number(row?.count ?? 0) }
}

/**
 * Get pending merge suggestion counts per post (for inbox badges).
 * Counts suggestions where the post is either source or target.
 */
export async function getMergeSuggestionCountsForPosts(
  postIds: PostId[]
): Promise<Array<{ postId: PostId; count: number }>> {
  if (postIds.length === 0) return []

  // Use two separate queries with inArray() (safe for Drizzle) then merge in JS.
  // Avoids raw SQL IN ${array} which Drizzle spreads without parens.
  const [sourceRows, targetRows] = await Promise.all([
    db
      .select({
        postId: mergeSuggestions.sourcePostId,
        count: count(),
      })
      .from(mergeSuggestions)
      .where(
        and(eq(mergeSuggestions.status, 'pending'), inArray(mergeSuggestions.sourcePostId, postIds))
      )
      .groupBy(mergeSuggestions.sourcePostId),
    db
      .select({
        postId: mergeSuggestions.targetPostId,
        count: count(),
      })
      .from(mergeSuggestions)
      .where(
        and(eq(mergeSuggestions.status, 'pending'), inArray(mergeSuggestions.targetPostId, postIds))
      )
      .groupBy(mergeSuggestions.targetPostId),
  ])

  // Merge counts from both sides
  const countMap = new Map<string, number>()
  for (const row of [...sourceRows, ...targetRows]) {
    countMap.set(row.postId, (countMap.get(row.postId) ?? 0) + Number(row.count))
  }

  return Array.from(countMap.entries())
    .filter(([, c]) => c > 0)
    .map(([postId, c]) => ({ postId: postId as PostId, count: c }))
}
