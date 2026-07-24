import {
  db,
  eq,
  and,
  or,
  inArray,
  desc,
  sql,
  isNull,
  gte,
  posts,
  boards,
  postTagAssignments,
  postTags,
  postVotes,
  postStatuses,
  userSegments,
  principal as principalTable,
} from '@/lib/server/db'
import {
  toUuid,
  type PostId,
  type PostStatusId,
  type PostTagId,
  type PrincipalId,
  type SegmentId,
} from '@quackback/ids'
import type { PublicPostListResult } from './post.types'
import type { RespondedFilter } from '@/lib/shared/types/filters'
import { postViewFilter, ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy'

import { getPublicUrlOrNull } from '@/lib/server/storage/s3'

/** Resolve avatar URL from principal's avatar fields */
export function resolveAvatarUrl(principal: {
  avatarKey?: string | null
  avatarUrl?: string | null
}): string | null {
  if (principal.avatarKey) {
    const s3Url = getPublicUrlOrNull(principal.avatarKey)
    if (s3Url) return s3Url
  }
  return principal.avatarUrl ?? null
}

export function parseJson<T>(value: string | T): T {
  return typeof value === 'string' ? JSON.parse(value) : value
}

export function parseAvatarData(json: string | null): string | null {
  if (!json) return null
  const data = parseJson<{ key?: string; url?: string }>(json)
  if (data.key) {
    const s3Url = getPublicUrlOrNull(data.key)
    if (s3Url) return s3Url
  }
  return data.url ?? null
}

type SortOrder = 'top' | 'new' | 'trending'

function getPostSortOrder(sort: SortOrder) {
  switch (sort) {
    case 'new':
      return desc(posts.createdAt)
    case 'trending':
      return sql`(${posts.voteCount} / GREATEST(1, EXTRACT(EPOCH FROM (NOW() - ${posts.createdAt})) / 86400)) DESC`
    default:
      return desc(posts.voteCount)
  }
}

export interface PostWithVotesAndAvatars {
  id: PostId
  title: string
  content: string | null
  statusId: PostStatusId | null
  voteCount: number
  commentCount: number
  authorName: string | null
  principalId: string
  createdAt: Date
  tags: Array<{ id: PostTagId; name: string; color: string }>
  board: { id: string; name: string; slug: string }
  hasVoted: boolean
  avatarUrl: string | null
}

interface PostListParams {
  boardSlug?: string
  search?: string
  statusIds?: PostStatusId[]
  statusSlugs?: string[]
  tagIds?: PostTagId[]
  sort?: SortOrder
  page?: number
  limit?: number
  minVotes?: number
  dateFrom?: string
  responded?: RespondedFilter
  /**
   * Team-only owner filter. `null` matches unassigned posts; a principal id
   * matches that owner. Undefined leaves ownership unfiltered. Callers must
   * gate this on post.view_private before passing it in — the query layer
   * does not re-check.
   */
  ownerId?: PrincipalId | null
  /** Team-only: restrict to posts authored by members of any of these segments. */
  segmentIds?: SegmentId[]
}

function buildPostFilterConditions(params: PostListParams, actor: Actor) {
  const { boardSlug, statusIds, statusSlugs, tagIds, search } = params
  // postViewFilter handles both the board-audience predicate and the
  // moderationState gate (e.g. hide 'pending' from non-authors). Compose
  // alongside the existing soft-delete + canonical-post filters — never
  // replace them.
  //
  // `isNull(boards.deletedAt)` is explicit here (rather than relying on
  // boardViewFilter) because postViewFilter's team-actor branch skips
  // boardViewFilter to grant admins visibility into team-only boards.
  // Soft-deleted boards must still be filtered for everyone — admins
  // never want stale tombstoned posts in the public portal feed.
  const conditions = [
    postViewFilter(actor),
    isNull(boards.deletedAt),
    isNull(posts.canonicalPostId),
    isNull(posts.deletedAt),
  ]

  if (boardSlug) {
    conditions.push(eq(boards.slug, boardSlug))
  }

  if (statusSlugs && statusSlugs.length > 0) {
    const statusIdSubquery = db
      .select({ id: postStatuses.id })
      .from(postStatuses)
      .where(inArray(postStatuses.slug, statusSlugs))
    conditions.push(inArray(posts.statusId, statusIdSubquery))
  } else if (statusIds && statusIds.length > 0) {
    conditions.push(inArray(posts.statusId, statusIds))
  } else {
    // Default: exclude complete/closed posts — only show active-category statuses (or unstatused)
    const activeStatusSubquery = db
      .select({ id: postStatuses.id })
      .from(postStatuses)
      .where(eq(postStatuses.category, 'active'))
    conditions.push(or(isNull(posts.statusId), inArray(posts.statusId, activeStatusSubquery))!)
  }

  if (tagIds && tagIds.length > 0) {
    const postIdsWithTagsSubquery = db
      .selectDistinct({ postId: postTagAssignments.postId })
      .from(postTagAssignments)
      .where(inArray(postTagAssignments.tagId, tagIds))
    conditions.push(inArray(posts.id, postIdsWithTagsSubquery))
  }

  if (search) {
    conditions.push(sql`${posts.searchVector} @@ websearch_to_tsquery('english', ${search})`)
  }

  if (typeof params.minVotes === 'number' && params.minVotes > 0) {
    conditions.push(gte(posts.voteCount, params.minVotes))
  }

  if (params.dateFrom) {
    conditions.push(gte(posts.createdAt, new Date(params.dateFrom)))
  }

  if (params.responded === 'responded') {
    // Raw column names for the inner post_comments table; outer posts.id via Drizzle
    // interpolation. Mirrors post.inbox.ts — see its comment for why ${postComments.postId}
    // would be incorrectly rewritten by Drizzle's relational query builder.
    conditions.push(
      sql`EXISTS (SELECT 1 FROM post_comments WHERE post_comments.post_id = ${posts.id} AND post_comments.is_team_member = true AND post_comments.deleted_at IS NULL)`
    )
  } else if (params.responded === 'unresponded') {
    conditions.push(
      sql`NOT EXISTS (SELECT 1 FROM post_comments WHERE post_comments.post_id = ${posts.id} AND post_comments.is_team_member = true AND post_comments.deleted_at IS NULL)`
    )
  }

  // Team-only owner filter — mirrors post.inbox.ts. `null` means unassigned;
  // a principal id restricts to that owner. The server fn only forwards these
  // for post.view_private holders, so no re-check here.
  if (params.ownerId === null) {
    conditions.push(sql`${posts.ownerPrincipalId} IS NULL`)
  } else if (params.ownerId) {
    conditions.push(eq(posts.ownerPrincipalId, params.ownerId))
  }

  // Team-only segment filter — posts whose author is in any selected segment.
  if (params.segmentIds && params.segmentIds.length > 0) {
    conditions.push(
      inArray(
        posts.principalId,
        db
          .select({ principalId: userSegments.principalId })
          .from(userSegments)
          .where(inArray(userSegments.segmentId, params.segmentIds))
      )
    )
  }

  return conditions
}

export async function listPublicPostsWithVotesAndAvatars(
  params: PostListParams & { principalId?: PrincipalId; actor?: Actor }
): Promise<{ items: PostWithVotesAndAvatars[]; hasMore: boolean }> {
  const { sort = 'top', page = 1, limit = 20, principalId, actor = ANONYMOUS_ACTOR } = params
  const offset = (page - 1) * limit
  const conditions = buildPostFilterConditions(params, actor)
  const orderBy = getPostSortOrder(sort)

  // Only authenticated users can vote, so we only check principal_id
  // Anonymous users see vote counts but hasVoted is always false
  const principalUuid = principalId ? toUuid(principalId) : null
  const voteExistsSubquery = principalUuid
    ? sql<boolean>`EXISTS(
        SELECT 1 FROM ${postVotes}
        WHERE ${postVotes.postId} = ${posts.id}
        AND ${postVotes.principalId} = ${principalUuid}::uuid
      )`.as('has_voted')
    : sql<boolean>`false`.as('has_voted')

  const postsResult = await db
    .select({
      id: posts.id,
      title: posts.title,
      content: posts.content,
      statusId: posts.statusId,
      voteCount: posts.voteCount,
      commentCount: posts.commentCount,
      principalId: posts.principalId,
      createdAt: posts.createdAt,
      boardId: boards.id,
      boardName: boards.name,
      boardSlug: boards.slug,
      hasVoted: voteExistsSubquery,
    })
    .from(posts)
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(limit + 1)
    .offset(offset)

  const hasMore = postsResult.length > limit
  const trimmedResults = hasMore ? postsResult.slice(0, limit) : postsResult

  // Batch-load tags and author identities for the page instead of running a
  // correlated subquery per row: one query over the page's post ids for tags,
  // one over the page's author principal ids for display name + avatar. Both
  // are keyed into maps and merged in JS below, preserving the response shape.
  const pagePostIds = trimmedResults.map((p) => p.id)
  const pageAuthorIds = [...new Set(trimmedResults.map((p) => p.principalId))]

  const [tagRows, authorRows] = await Promise.all([
    pagePostIds.length > 0
      ? db
          .select({
            postId: postTagAssignments.postId,
            id: postTags.id,
            name: postTags.name,
            color: postTags.color,
          })
          .from(postTagAssignments)
          .innerJoin(postTags, eq(postTags.id, postTagAssignments.tagId))
          .where(inArray(postTagAssignments.postId, pagePostIds))
      : Promise.resolve([]),
    pageAuthorIds.length > 0
      ? db
          .select({
            id: principalTable.id,
            displayName: principalTable.displayName,
            avatarKey: principalTable.avatarKey,
            avatarUrl: principalTable.avatarUrl,
          })
          .from(principalTable)
          .where(inArray(principalTable.id, pageAuthorIds))
      : Promise.resolve([]),
  ])

  const tagsByPost = new Map<string, Array<{ id: PostTagId; name: string; color: string }>>()
  for (const row of tagRows) {
    const list = tagsByPost.get(row.postId) ?? []
    list.push({ id: row.id, name: row.name, color: row.color })
    tagsByPost.set(row.postId, list)
  }
  const authorById = new Map(authorRows.map((a) => [a.id, a]))

  const items = trimmedResults.map((post): PostWithVotesAndAvatars => {
    const author = authorById.get(post.principalId)
    // Mirror the previous correlated subquery's avatar precedence exactly: the
    // stored key (resolved to its S3 URL) wins, with the raw avatar_url only
    // used when no key is present.
    const avatarUrl = author?.avatarKey
      ? getPublicUrlOrNull(author.avatarKey)
      : (author?.avatarUrl ?? null)
    return {
      id: post.id,
      title: post.title,
      content: post.content,
      statusId: post.statusId,
      voteCount: post.voteCount,
      commentCount: post.commentCount,
      authorName: author?.displayName ?? null,
      principalId: post.principalId,
      createdAt: post.createdAt,
      tags: tagsByPost.get(post.id) ?? [],
      board: { id: post.boardId, name: post.boardName, slug: post.boardSlug },
      hasVoted: post.hasVoted ?? false,
      avatarUrl,
    }
  })

  return { items, hasMore }
}

export async function listPublicPosts(
  params: PostListParams & { actor?: Actor }
): Promise<PublicPostListResult> {
  const { sort = 'top', page = 1, limit = 20, actor = ANONYMOUS_ACTOR } = params
  const offset = (page - 1) * limit
  const conditions = buildPostFilterConditions(params, actor)
  const orderBy = getPostSortOrder(sort)

  const postsResult = await db
    .select({
      id: posts.id,
      title: posts.title,
      content: posts.content,
      statusId: posts.statusId,
      voteCount: posts.voteCount,
      commentCount: posts.commentCount,
      principalId: posts.principalId,
      createdAt: posts.createdAt,
      boardId: boards.id,
      boardName: boards.name,
      boardSlug: boards.slug,
      tagsJson: sql<string>`COALESCE(
        (SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color))
         FROM ${postTagAssignments} pt
         INNER JOIN ${postTags} t ON t.id = pt.tag_id
         WHERE pt.post_id = ${posts.id}),
        '[]'
      )`.as('tags_json'),
      authorName: sql<string | null>`(
        SELECT m.display_name FROM ${principalTable} m
        WHERE m.id = ${posts.principalId}
      )`.as('author_name'),
    })
    .from(posts)
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(limit + 1)
    .offset(offset)

  const hasMore = postsResult.length > limit
  const trimmedResults = hasMore ? postsResult.slice(0, limit) : postsResult

  const items = trimmedResults.map((post) => ({
    id: post.id,
    title: post.title,
    content: post.content,
    statusId: post.statusId,
    voteCount: post.voteCount,
    authorName: post.authorName,
    principalId: post.principalId,
    createdAt: post.createdAt,
    commentCount: post.commentCount,
    tags: parseJson<Array<{ id: PostTagId; name: string; color: string }>>(post.tagsJson),
    board: { id: post.boardId, name: post.boardName, slug: post.boardSlug },
  }))

  return { items, total: undefined, hasMore }
}

export async function getAllUserVotedPostIds(principalId: PrincipalId): Promise<Set<PostId>> {
  const result = await db
    .select({ postId: postVotes.postId })
    .from(postVotes)
    .where(eq(postVotes.principalId, principalId))
  return new Set(result.map((r) => r.postId))
}

export async function getVotedPostIdsByUserId(
  userId: import('@quackback/ids').UserId
): Promise<Set<PostId>> {
  const result = await db
    .select({ postId: postVotes.postId })
    .from(postVotes)
    .innerJoin(principalTable, eq(postVotes.principalId, principalTable.id))
    .where(eq(principalTable.userId, userId))
  return new Set(result.map((r) => r.postId))
}

export async function getBoardByPostId(
  postId: PostId
): Promise<import('@quackback/db').Board | null> {
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
    with: { board: true },
  })

  return post?.board || null
}
