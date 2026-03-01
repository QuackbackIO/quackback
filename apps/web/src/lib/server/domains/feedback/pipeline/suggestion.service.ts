/**
 * Suggestion service — create, accept, dismiss feedback suggestions.
 *
 * Suggestions are the output of the feedback pipeline. They recommend
 * either merging feedback into an existing post or creating a new post.
 */

import { db, eq, and, feedbackSuggestions, posts, votes, sql } from '@/lib/server/db'
import { subscribeToPost } from '@/lib/server/domains/subscriptions/subscription.service'
import { sendFeedbackAttributionEmail } from './feedback-attribution-email'
import type {
  FeedbackSuggestionId,
  PostId,
  BoardId,
  PrincipalId,
  RawFeedbackItemId,
  FeedbackSignalId,
} from '@quackback/ids'

/**
 * Create a merge_post suggestion: "This feedback matches existing Post X"
 */
export async function createMergeSuggestion(opts: {
  rawFeedbackItemId: RawFeedbackItemId
  signalId?: FeedbackSignalId
  targetPostId: PostId
  similarityScore: number
  reasoning: string
  embedding?: number[]
}): Promise<FeedbackSuggestionId | null> {
  const vectorStr = opts.embedding ? `[${opts.embedding.join(',')}]` : null

  const inserted = await db
    .insert(feedbackSuggestions)
    .values({
      suggestionType: 'merge_post',
      rawFeedbackItemId: opts.rawFeedbackItemId,
      signalId: opts.signalId ?? null,
      targetPostId: opts.targetPostId,
      similarityScore: opts.similarityScore,
      reasoning: opts.reasoning,
      ...(vectorStr && { embedding: sql`${vectorStr}::vector` as any }),
    } as any)
    .onConflictDoNothing() // Partial unique index prevents duplicate pending merge suggestions
    .returning({ id: feedbackSuggestions.id })

  return inserted[0]?.id ?? null
}

/**
 * Create a create_post suggestion: "Create a new post from this feedback"
 */
export async function createPostSuggestion(opts: {
  rawFeedbackItemId: RawFeedbackItemId
  signalId?: FeedbackSignalId
  boardId?: BoardId
  suggestedTitle: string
  suggestedBody: string
  reasoning: string
  embedding?: number[]
}): Promise<FeedbackSuggestionId> {
  const vectorStr = opts.embedding ? `[${opts.embedding.join(',')}]` : null

  const [inserted] = await db
    .insert(feedbackSuggestions)
    .values({
      suggestionType: 'create_post',
      rawFeedbackItemId: opts.rawFeedbackItemId,
      signalId: opts.signalId ?? null,
      boardId: opts.boardId ?? null,
      suggestedTitle: opts.suggestedTitle,
      suggestedBody: opts.suggestedBody,
      reasoning: opts.reasoning,
      ...(vectorStr && { embedding: sql`${vectorStr}::vector` as any }),
    } as any)
    .returning({ id: feedbackSuggestions.id })

  return inserted.id
}

/**
 * Accept a merge suggestion: add a vote to the target post.
 * For quackback posts, sets canonicalPostId (existing merge mechanism).
 */
export async function acceptMergeSuggestion(
  suggestionId: FeedbackSuggestionId,
  resolvedByPrincipalId: PrincipalId
): Promise<{ success: boolean; resultPostId: PostId }> {
  const suggestion = await db.query.feedbackSuggestions.findFirst({
    where: eq(feedbackSuggestions.id, suggestionId),
    with: {
      rawItem: {
        columns: { sourceType: true, externalId: true, principalId: true },
      },
    },
  })

  if (
    !suggestion ||
    suggestion.status !== 'pending' ||
    suggestion.suggestionType !== 'merge_post'
  ) {
    throw new Error('Invalid suggestion for merge accept')
  }

  const targetPostId = suggestion.targetPostId as PostId
  const rawItem = suggestion.rawItem

  if (rawItem?.sourceType === 'quackback') {
    // Quackback post: set canonicalPostId on the source post
    const match = rawItem.externalId.match(/^post:(.+)$/)
    if (match) {
      const sourcePostId = match[1] as PostId
      await db
        .update(posts)
        .set({
          canonicalPostId: targetPostId,
          mergedAt: new Date(),
          mergedByPrincipalId: resolvedByPrincipalId,
          updatedAt: new Date(),
        })
        .where(eq(posts.id, sourcePostId))
    }
  } else if (rawItem?.principalId) {
    // External source: add a vote on behalf of the external author
    const [inserted] = await db
      .insert(votes)
      .values({
        postId: targetPostId,
        principalId: rawItem.principalId as PrincipalId,
      })
      .onConflictDoNothing()
      .returning({ id: votes.id })

    // Only increment vote count if the vote was actually inserted
    if (inserted) {
      await db
        .update(posts)
        .set({ voteCount: sql`${posts.voteCount} + 1`, updatedAt: new Date() })
        .where(eq(posts.id, targetPostId))
    }
  }

  // Subscribe external author to the target post for future updates
  if (rawItem?.principalId) {
    await subscribeToPost(rawItem.principalId as PrincipalId, targetPostId, 'feedback_author')
    await sendFeedbackAttributionEmail(
      rawItem.principalId as PrincipalId,
      targetPostId,
      resolvedByPrincipalId
    )
  }

  // Mark suggestion as accepted
  await db
    .update(feedbackSuggestions)
    .set({
      status: 'accepted',
      resultPostId: targetPostId,
      resolvedAt: new Date(),
      resolvedByPrincipalId: resolvedByPrincipalId,
      updatedAt: new Date(),
    })
    .where(eq(feedbackSuggestions.id, suggestionId))

  return { success: true, resultPostId: targetPostId }
}

/**
 * Accept a create_post suggestion: create a new post on the selected board.
 */
export async function acceptCreateSuggestion(
  suggestionId: FeedbackSuggestionId,
  resolvedByPrincipalId: PrincipalId,
  edits?: { title?: string; body?: string; boardId?: string }
): Promise<{ success: boolean; resultPostId: PostId }> {
  const suggestion = await db.query.feedbackSuggestions.findFirst({
    where: eq(feedbackSuggestions.id, suggestionId),
    with: {
      rawItem: {
        columns: { principalId: true },
      },
    },
  })

  if (
    !suggestion ||
    suggestion.status !== 'pending' ||
    suggestion.suggestionType !== 'create_post'
  ) {
    throw new Error('Invalid suggestion for create accept')
  }

  const title = edits?.title ?? suggestion.suggestedTitle ?? 'Untitled'
  const body = edits?.body ?? suggestion.suggestedBody ?? ''
  const boardId = (edits?.boardId ?? suggestion.boardId) as BoardId | null

  if (!boardId) {
    throw new Error('Board is required to create a post')
  }

  // Get the default status for new posts
  const { postStatuses } = await import('@/lib/server/db')
  const defaultStatus = await db.query.postStatuses.findFirst({
    where: eq(postStatuses.isDefault, true),
    columns: { id: true },
  })

  // Create post with the feedback author as the author
  const authorPrincipalId = (suggestion.rawItem?.principalId ??
    resolvedByPrincipalId) as PrincipalId

  const [newPost] = await db
    .insert(posts)
    .values({
      title,
      content: body,
      boardId,
      principalId: authorPrincipalId,
      statusId: defaultStatus?.id,
      voteCount: 1,
    })
    .returning({ id: posts.id })

  const newPostId = newPost.id as PostId

  // Add initial vote from the author
  await db
    .insert(votes)
    .values({
      postId: newPostId,
      principalId: authorPrincipalId,
    })
    .onConflictDoNothing()

  // Subscribe author to the new post for future updates
  await subscribeToPost(authorPrincipalId, newPostId, 'feedback_author')

  // Send attribution email to external authors (not the admin who accepted)
  if (authorPrincipalId !== resolvedByPrincipalId) {
    await sendFeedbackAttributionEmail(authorPrincipalId, newPostId, resolvedByPrincipalId)
  }

  // Mark suggestion as accepted
  await db
    .update(feedbackSuggestions)
    .set({
      status: 'accepted',
      resultPostId: newPostId,
      resolvedAt: new Date(),
      resolvedByPrincipalId: resolvedByPrincipalId,
      updatedAt: new Date(),
    })
    .where(eq(feedbackSuggestions.id, suggestionId))

  return { success: true, resultPostId: newPostId }
}

/**
 * Dismiss a suggestion.
 */
export async function dismissSuggestion(
  suggestionId: FeedbackSuggestionId,
  resolvedByPrincipalId: PrincipalId
): Promise<void> {
  await db
    .update(feedbackSuggestions)
    .set({
      status: 'dismissed',
      resolvedAt: new Date(),
      resolvedByPrincipalId: resolvedByPrincipalId,
      updatedAt: new Date(),
    })
    .where(and(eq(feedbackSuggestions.id, suggestionId), eq(feedbackSuggestions.status, 'pending')))
}

/**
 * Expire stale pending suggestions older than 30 days.
 */
export async function expireStaleSuggestions(): Promise<number> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const result = await db
    .update(feedbackSuggestions)
    .set({
      status: 'expired',
      resolvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(feedbackSuggestions.status, 'pending'),
        sql`${feedbackSuggestions.createdAt} < ${thirtyDaysAgo}`
      )
    )
    .returning({ id: feedbackSuggestions.id })

  return result.length
}
