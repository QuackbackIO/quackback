/**
 * Suggestion service — create, accept, dismiss feedback suggestions.
 *
 * Suggestions are the output of the feedback pipeline. They recommend
 * creating a new post from external feedback signals.
 */

import { db, eq, and, feedbackSuggestions, posts, votes, sql } from '@/lib/server/db'
import type { SQL } from 'drizzle-orm'
import { subscribeToPost } from '@/lib/server/domains/subscriptions/subscription.service'
import { createActivity } from '@/lib/server/domains/activity/activity.service'
import { addVoteOnBehalf } from '@/lib/server/domains/posts/post.voting'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { logPipelineEvent } from './pipeline-log'
import { sendFeedbackAttributionEmail } from './feedback-attribution-email'
import type {
  FeedbackSuggestionId,
  PostId,
  BoardId,
  PrincipalId,
  RawFeedbackItemId,
  FeedbackSignalId,
  StatusId,
} from '@quackback/ids'

type SimilarPostEntry = { postId: string; title: string; similarity: number; voteCount: number }

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
  similarPosts?: SimilarPostEntry[]
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
      similarPosts: opts.similarPosts ?? null,
      ...(vectorStr && { embedding: sql`${vectorStr}::vector` as SQL<number[]> }),
    } as typeof feedbackSuggestions.$inferInsert)
    .returning({ id: feedbackSuggestions.id })

  return inserted.id
}

/**
 * Create a vote_on_post suggestion: "Vote on an existing post on behalf of this feedback author"
 */
export async function createVoteSuggestion(opts: {
  rawFeedbackItemId: RawFeedbackItemId
  signalId?: FeedbackSignalId
  resultPostId: PostId
  boardId?: BoardId
  suggestedTitle: string
  suggestedBody: string
  reasoning: string
  embedding?: number[]
  similarPosts?: SimilarPostEntry[]
}): Promise<FeedbackSuggestionId> {
  const vectorStr = opts.embedding ? `[${opts.embedding.join(',')}]` : null

  const [inserted] = await db
    .insert(feedbackSuggestions)
    .values({
      suggestionType: 'vote_on_post',
      rawFeedbackItemId: opts.rawFeedbackItemId,
      signalId: opts.signalId ?? null,
      boardId: opts.boardId ?? null,
      resultPostId: opts.resultPostId,
      suggestedTitle: opts.suggestedTitle,
      suggestedBody: opts.suggestedBody,
      reasoning: opts.reasoning,
      similarPosts: opts.similarPosts ?? null,
      ...(vectorStr && { embedding: sql`${vectorStr}::vector` as SQL<number[]> }),
    } as typeof feedbackSuggestions.$inferInsert)
    .returning({ id: feedbackSuggestions.id })

  return inserted.id
}

/**
 * Accept a create_post suggestion: create a new post on the selected board.
 */
export async function acceptCreateSuggestion(
  suggestionId: FeedbackSuggestionId,
  resolvedByPrincipalId: PrincipalId,
  edits?: {
    title?: string
    body?: string
    boardId?: string
    statusId?: string
    authorPrincipalId?: string
  }
): Promise<{ success: boolean; resultPostId: PostId }> {
  const suggestion = await db.query.feedbackSuggestions.findFirst({
    where: eq(feedbackSuggestions.id, suggestionId),
    columns: { embedding: false },
    with: {
      rawItem: {
        columns: { principalId: true, sourceType: true },
      },
    },
  })

  if (
    !suggestion ||
    suggestion.status !== 'pending' ||
    (suggestion.suggestionType !== 'create_post' && suggestion.suggestionType !== 'vote_on_post')
  ) {
    throw new NotFoundError(
      'SUGGESTION_NOT_FOUND',
      'Suggestion not found or not eligible for create accept'
    )
  }

  const title = edits?.title ?? suggestion.suggestedTitle ?? 'Untitled'
  const body = edits?.body ?? suggestion.suggestedBody ?? ''
  const boardId = (edits?.boardId ?? suggestion.boardId) as BoardId | null

  if (!boardId) {
    throw new ValidationError('VALIDATION_ERROR', 'Board is required to create a post')
  }

  // Get the default status for new posts
  const { postStatuses } = await import('@/lib/server/db')
  const defaultStatus = await db.query.postStatuses.findFirst({
    where: eq(postStatuses.isDefault, true),
    columns: { id: true },
  })

  // Resolve author: use explicit override, or feedback author, or accepting admin
  const authorPrincipalId = (edits?.authorPrincipalId ??
    suggestion.rawItem?.principalId ??
    resolvedByPrincipalId) as PrincipalId

  // Use explicit statusId override or fall back to default
  const statusId = (edits?.statusId ?? defaultStatus?.id) as StatusId | undefined

  const [newPost] = await db
    .insert(posts)
    .values({
      title,
      content: body,
      boardId,
      principalId: authorPrincipalId,
      statusId,
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

  // Record activity — uses post.created with feedback provenance in metadata
  createActivity({
    postId: newPostId,
    principalId: resolvedByPrincipalId,
    type: 'post.created',
    metadata: {
      source: 'feedback_suggestion',
      suggestionId,
      suggestionType: suggestion.suggestionType,
      rawFeedbackItemId: suggestion.rawFeedbackItemId,
    },
  })

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

  await logPipelineEvent({
    eventType: 'suggestion.accepted',
    rawFeedbackItemId: suggestion.rawFeedbackItemId,
    suggestionId,
    postId: newPostId,
    detail: {
      suggestionType: suggestion.suggestionType,
      sourceType: suggestion.rawItem?.sourceType ?? null,
      resultPostId: newPostId,
      resolvedByPrincipalId,
      edits: {
        titleChanged: (edits?.title ?? null) !== null && edits?.title !== suggestion.suggestedTitle,
        bodyChanged: (edits?.body ?? null) !== null && edits?.body !== suggestion.suggestedBody,
        boardChanged: (edits?.boardId ?? null) !== null && edits?.boardId !== suggestion.boardId,
        authorChanged: (edits?.authorPrincipalId ?? null) !== null,
      },
    },
  })

  return { success: true, resultPostId: newPostId }
}

/**
 * Accept a vote_on_post suggestion: cast a proxy vote on the matched post
 * on behalf of the feedback author.
 */
export async function acceptVoteSuggestion(
  suggestionId: FeedbackSuggestionId,
  resolvedByPrincipalId: PrincipalId
): Promise<{ success: boolean; resultPostId: PostId }> {
  const suggestion = await db.query.feedbackSuggestions.findFirst({
    where: eq(feedbackSuggestions.id, suggestionId),
    columns: { embedding: false },
    with: {
      rawItem: {
        columns: { principalId: true, sourceType: true, externalUrl: true, author: true },
      },
    },
  })

  if (
    !suggestion ||
    suggestion.status !== 'pending' ||
    suggestion.suggestionType !== 'vote_on_post'
  ) {
    throw new NotFoundError(
      'SUGGESTION_NOT_FOUND',
      'Suggestion not found or not eligible for vote accept'
    )
  }

  const targetPostId = suggestion.resultPostId as PostId
  if (!targetPostId) {
    throw new ValidationError('VALIDATION_ERROR', 'No target post for vote suggestion')
  }

  const voterPrincipalId = suggestion.rawItem?.principalId as PrincipalId | undefined
  if (!voterPrincipalId) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      'Cannot cast proxy vote: feedback author has no linked account'
    )
  }

  const sourceType = suggestion.rawItem?.sourceType ?? 'feedback'
  const externalUrl = suggestion.rawItem?.externalUrl ?? undefined
  const voterName = (suggestion.rawItem?.author as { name?: string } | null)?.name ?? null

  await addVoteOnBehalf(
    targetPostId,
    voterPrincipalId,
    {
      type: sourceType,
      externalUrl: externalUrl ?? '',
    },
    suggestionId
  )

  // Record activity: "Admin X voted on behalf of User Y via Slack"
  createActivity({
    postId: targetPostId,
    principalId: resolvedByPrincipalId,
    type: 'vote.proxy',
    metadata: {
      voterPrincipalId,
      voterName,
      sourceType,
      suggestionId,
      rawFeedbackItemId: suggestion.rawFeedbackItemId,
    },
  })

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

  await logPipelineEvent({
    eventType: 'suggestion.accepted',
    rawFeedbackItemId: suggestion.rawFeedbackItemId,
    suggestionId,
    postId: targetPostId,
    detail: {
      suggestionType: 'vote_on_post',
      sourceType,
      resultPostId: targetPostId,
      resolvedByPrincipalId,
    },
  })

  return { success: true, resultPostId: targetPostId }
}

/**
 * Dismiss a suggestion.
 */
export async function dismissSuggestion(
  suggestionId: FeedbackSuggestionId,
  resolvedByPrincipalId: PrincipalId
): Promise<void> {
  const [updated] = await db
    .update(feedbackSuggestions)
    .set({
      status: 'dismissed',
      resolvedAt: new Date(),
      resolvedByPrincipalId: resolvedByPrincipalId,
      updatedAt: new Date(),
    })
    .where(and(eq(feedbackSuggestions.id, suggestionId), eq(feedbackSuggestions.status, 'pending')))
    .returning({
      id: feedbackSuggestions.id,
      rawFeedbackItemId: feedbackSuggestions.rawFeedbackItemId,
    })

  if (updated) {
    await logPipelineEvent({
      eventType: 'suggestion.dismissed',
      rawFeedbackItemId: updated.rawFeedbackItemId,
      suggestionId,
      detail: { resolvedByPrincipalId },
    })
  }
}

/**
 * Restore a dismissed suggestion back to pending.
 */
export async function restoreSuggestion(
  suggestionId: FeedbackSuggestionId,
  restoredByPrincipalId: PrincipalId
): Promise<void> {
  const [updated] = await db
    .update(feedbackSuggestions)
    .set({
      status: 'pending',
      resolvedAt: null,
      resolvedByPrincipalId: null,
      updatedAt: new Date(),
    })
    .where(
      and(eq(feedbackSuggestions.id, suggestionId), eq(feedbackSuggestions.status, 'dismissed'))
    )
    .returning({
      id: feedbackSuggestions.id,
      rawFeedbackItemId: feedbackSuggestions.rawFeedbackItemId,
    })

  if (updated) {
    await logPipelineEvent({
      eventType: 'suggestion.restored',
      rawFeedbackItemId: updated.rawFeedbackItemId,
      suggestionId,
      detail: { restoredByPrincipalId },
    })
  }
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
        sql`${feedbackSuggestions.createdAt} < ${thirtyDaysAgo.toISOString()}`
      )
    )
    .returning({
      id: feedbackSuggestions.id,
      rawFeedbackItemId: feedbackSuggestions.rawFeedbackItemId,
      createdAt: feedbackSuggestions.createdAt,
    })

  for (const expired of result) {
    const ageDays = Math.floor(
      (Date.now() - new Date(expired.createdAt).getTime()) / (24 * 60 * 60 * 1000)
    )
    await logPipelineEvent({
      eventType: 'suggestion.expired',
      rawFeedbackItemId: expired.rawFeedbackItemId,
      suggestionId: expired.id,
      detail: {
        expiredBy: 'system',
        reasonCode: 'stale',
        ageDays,
      },
    })
  }

  return result.length
}
