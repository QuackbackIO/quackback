/**
 * Post Export Queries
 *
 * Handles exporting posts to CSV and retrieving feedback source metadata.
 */

import {
  db,
  posts,
  postStatuses,
  feedbackSuggestions,
  rawFeedbackItems,
  eq,
  and,
  inArray,
  desc,
  sql,
  isNull,
} from '@/lib/server/db'
import { type PostId, type BoardId } from '@quackback/ids'
import type { PostForExport } from './post.types'

/**
 * List posts for export (all posts with full details)
 *
 * @param boardId - Optional board ID to filter by
 * @returns Result containing posts for export or an error
 */
export async function listPostsForExport(boardId: BoardId | undefined): Promise<PostForExport[]> {
  // Get board IDs - either specific board or all boards
  const allBoardIds = boardId
    ? [boardId]
    : (
        await db.query.boards.findMany({
          columns: { id: true },
        })
      ).map((b) => b.id)

  if (allBoardIds.length === 0) {
    return []
  }

  // Get posts with board and tags (limit to prevent memory exhaustion)
  const MAX_EXPORT_POSTS = 10000
  const rawPosts = await db.query.posts.findMany({
    columns: {
      id: true,
      boardId: true,
      title: true,
      content: true,
      principalId: true,
      statusId: true,
      voteCount: true,
      commentCount: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
      canonicalPostId: true,
    },
    where: and(inArray(posts.boardId, allBoardIds), isNull(posts.deletedAt)),
    orderBy: desc(posts.createdAt),
    limit: MAX_EXPORT_POSTS,
    with: {
      board: {
        columns: { id: true, name: true, slug: true },
      },
      tags: {
        with: {
          tag: {
            columns: { id: true, name: true, color: true },
          },
        },
      },
      author: {
        columns: { displayName: true },
        with: {
          user: {
            columns: { email: true },
          },
        },
      },
    },
  })

  // Get status details for posts that have a statusId (use Set for O(n) deduplication)
  const postStatusIds = [...new Set(rawPosts.filter((p) => p.statusId).map((p) => p.statusId!))]

  const statusDetails =
    postStatusIds.length > 0
      ? await db.query.postStatuses.findMany({
          where: inArray(postStatuses.id, postStatusIds),
        })
      : []

  const statusMap = new Map(statusDetails.map((s) => [s.id, { name: s.name, color: s.color }]))

  // Transform to export format
  return rawPosts.map(
    (post): PostForExport => ({
      id: post.id,
      title: post.title,
      content: post.content,
      statusId: post.statusId,
      voteCount: post.voteCount,
      authorName: post.author?.displayName ?? null,
      authorEmail: post.author?.user?.email ?? null,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      board: {
        id: post.board.id,
        name: post.board.name,
        slug: post.board.slug,
      },
      tags: post.tags.map((pt) => pt.tag),
      statusDetails: post.statusId ? statusMap.get(post.statusId) : undefined,
    })
  )
}

export interface PostFeedbackSource {
  sourceType: string
  authorName: string | null
  quote: string
  externalUrl: string | null
  createdAt: Date
}

/**
 * Get the feedback source for a post, if it was created from a feedback suggestion.
 * Returns the original quote, source type (e.g. "slack"), and author info.
 */
export async function getPostFeedbackSource(postId: PostId): Promise<PostFeedbackSource | null> {
  const row = await db
    .select({
      sourceType: rawFeedbackItems.sourceType,
      authorName: sql<string | null>`${rawFeedbackItems.author}->>'name'`,
      quote: sql<string>`${rawFeedbackItems.content}->>'text'`,
      externalUrl: rawFeedbackItems.externalUrl,
      createdAt: rawFeedbackItems.sourceCreatedAt,
    })
    .from(feedbackSuggestions)
    .innerJoin(rawFeedbackItems, eq(rawFeedbackItems.id, feedbackSuggestions.rawFeedbackItemId))
    .where(
      and(
        eq(feedbackSuggestions.resultPostId, postId),
        eq(feedbackSuggestions.status, 'accepted'),
        eq(feedbackSuggestions.suggestionType, 'create_post')
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!row) return null

  return {
    sourceType: row.sourceType,
    authorName: row.authorName,
    quote: row.quote,
    externalUrl: row.externalUrl,
    createdAt: row.createdAt,
  }
}
