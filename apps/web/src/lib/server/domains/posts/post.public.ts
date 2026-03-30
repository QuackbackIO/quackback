import {
  db,
  eq,
  and,
  inArray,
  desc,
  sql,
  isNull,
  posts,
  boards,
  postTags,
  tags,
  votes,
  postStatuses,
  principal as principalTable,
} from '@/lib/server/db'
import { toUuid, type PostId, type StatusId, type TagId, type PrincipalId } from '@featurepool/ids'
import type { PublicPostListResult } from './post.types'

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
  statusId: StatusId | null
  voteCount: number
  commentCount: number
  authorName: string | null
  principalId: string
  createdAt: Date
  tags: Array<{ id: TagId; name: string; color: string }>
  board: { id: string; name: string; slug: string }
  hasVoted: boolean
  avatarUrl: string | null
}

interface PostListParams {
  boardSlug?: string
  search?: string
  statusIds?: StatusId[]
  statusSlugs?: string[]
  tagIds?: TagId[]
  sort?: SortOrder
  page?: number
  limit?: number
}

function buildPostFilterConditions(params: PostListParams) {
  const { boardSlug, statusIds, statusSlugs, tagIds, search } = params
  const conditions = [
    eq(boards.isPublic, true),
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
  }

  if (tagIds && tagIds.length > 0) {
    const postIdsWithTagsSubquery = db
      .selectDistinct({ postId: postTags.postId })
      .from(postTags)
      .where(inArray(postTags.tagId, tagIds))
    conditions.push(inArray(posts.id, postIdsWithTagsSubquery))
  }

  if (search) {
    conditions.push(sql`${posts.searchVector} @@ websearch_to_tsquery('english', ${search})`)
  }

  return conditions
}

export async function listPublicPostsWithVotesAndAvatars(
  params: PostListParams & { principalId?: PrincipalId }
): Promise<{ items: PostWithVotesAndAvatars[]; hasMore: boolean }> {
  const { sort = 'top', page = 1, limit = 20, principalId } = params
  const offset = (page - 1) * limit
  const conditions = buildPostFilterConditions(params)
  const orderBy = getPostSortOrder(sort)

  // Only authenticated users can vote, so we only check principal_id
  // Anonymous users see vote counts but hasVoted is always false
  const principalUuid = principalId ? toUuid(principalId) : null
  const voteExistsSubquery = principalUuid
    ? sql<boolean>`EXISTS(
        SELECT 1 FROM ${votes}
        WHERE ${votes.postId} = ${posts.id}
        AND ${votes.principalId} = ${principalUuid}::uuid
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
      tagsJson: sql<string>`COALESCE(
        (SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color))
         FROM ${postTags} pt
         INNER JOIN ${tags} t ON t.id = pt.tag_id
         WHERE pt.post_id = ${posts.id}),
        '[]'
      )`.as('tags_json'),
      hasVoted: voteExistsSubquery,
      authorName: sql<string | null>`(
        SELECT m.display_name FROM ${principalTable} m
        WHERE m.id = ${posts.principalId}
      )`.as('author_name'),
      avatarData: sql<string | null>`(
        SELECT CASE
          WHEN m.avatar_key IS NOT NULL
          THEN json_build_object('key', m.avatar_key)
          ELSE json_build_object('url', m.avatar_url)
        END
        FROM ${principalTable} m
        WHERE m.id = ${posts.principalId}
      )`.as('avatar_data'),
    })
    .from(posts)
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(limit + 1)
    .offset(offset)

  const hasMore = postsResult.length > limit
  const trimmedResults = hasMore ? postsResult.slice(0, limit) : postsResult

  const items = trimmedResults.map(
    (post): PostWithVotesAndAvatars => ({
      id: post.id,
      title: post.title,
      content: post.content,
      statusId: post.statusId,
      voteCount: post.voteCount,
      commentCount: post.commentCount,
      authorName: post.authorName,
      principalId: post.principalId,
      createdAt: post.createdAt,
      tags: parseJson<Array<{ id: TagId; name: string; color: string }>>(post.tagsJson),
      board: { id: post.boardId, name: post.boardName, slug: post.boardSlug },
      hasVoted: post.hasVoted ?? false,
      avatarUrl: parseAvatarData(post.avatarData),
    })
  )

  return { items, hasMore }
}

export async function listPublicPosts(params: PostListParams): Promise<PublicPostListResult> {
  const { sort = 'top', page = 1, limit = 20 } = params
  const offset = (page - 1) * limit
  const conditions = buildPostFilterConditions(params)
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
         FROM ${postTags} pt
         INNER JOIN ${tags} t ON t.id = pt.tag_id
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
    tags: parseJson<Array<{ id: TagId; name: string; color: string }>>(post.tagsJson),
    board: { id: post.boardId, name: post.boardName, slug: post.boardSlug },
  }))

  return { items, total: -1, hasMore }
}

export async function getAllUserVotedPostIds(principalId: PrincipalId): Promise<Set<PostId>> {
  const result = await db
    .select({ postId: votes.postId })
    .from(votes)
    .where(eq(votes.principalId, principalId))
  return new Set(result.map((r) => r.postId))
}

export async function getVotedPostIdsByUserId(
  userId: import('@featurepool/ids').UserId
): Promise<Set<PostId>> {
  const result = await db
    .select({ postId: votes.postId })
    .from(votes)
    .innerJoin(principalTable, eq(votes.principalId, principalTable.id))
    .where(eq(principalTable.userId, userId))
  return new Set(result.map((r) => r.postId))
}

export async function getBoardByPostId(
  postId: PostId
): Promise<import('@featurepool/db').Board | null> {
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
    with: { board: true },
  })

  return post?.board || null
}
