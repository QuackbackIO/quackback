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
} from '@/lib/server/db'
import { mergePost } from '@/lib/server/domains/posts/post.merge'
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
}

/**
 * Create a merge suggestion. Uses onConflictDoNothing for the partial unique index.
 */
export async function createMergeSuggestion(opts: CreateMergeSuggestionOpts): Promise<void> {
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
  principalId: PrincipalId
): Promise<void> {
  const suggestion = await db.query.mergeSuggestions.findFirst({
    where: (s, { eq }) => eq(s.id, id),
  })

  if (!suggestion || suggestion.status !== 'pending') {
    throw new Error('Merge suggestion not found or already resolved')
  }

  // Perform the actual merge
  await mergePost(suggestion.sourcePostId, suggestion.targetPostId, principalId)

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
 * Get pending merge suggestions for a post (where the post is source OR target).
 */
export async function getPendingSuggestionsForPost(postId: PostId): Promise<MergeSuggestionView[]> {
  const sourcePostsAlias = db
    .select({
      id: posts.id,
      title: posts.title,
      voteCount: posts.voteCount,
    })
    .from(posts)
    .as('source_posts')

  const targetPostsAlias = db
    .select({
      id: posts.id,
      title: posts.title,
      voteCount: posts.voteCount,
    })
    .from(posts)
    .as('target_posts')

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
    })
    .from(mergeSuggestions)
    .innerJoin(sourcePostsAlias, eq(mergeSuggestions.sourcePostId, sourcePostsAlias.id))
    .innerJoin(targetPostsAlias, eq(mergeSuggestions.targetPostId, targetPostsAlias.id))
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
  sort?: 'newest' | 'similarity' | 'confidence'
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
  // Step 1: Fetch count + merge suggestion rows in parallel
  const orderBy =
    opts.sort === 'similarity'
      ? [desc(mergeSuggestions.hybridScore), desc(mergeSuggestions.createdAt)]
      : opts.sort === 'confidence'
        ? [desc(mergeSuggestions.llmConfidence), desc(mergeSuggestions.createdAt)]
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
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
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
