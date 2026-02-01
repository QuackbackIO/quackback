import {
  db,
  eq,
  and,
  inArray,
  desc,
  sql,
  posts,
  boards,
  postTags,
  tags,
  comments,
  commentReactions,
  votes,
  postStatuses,
  postRoadmaps,
  roadmaps,
  postSubscriptions,
  member as memberTable,
  user as userTable,
} from '@/lib/server/db'
import {
  toUuid,
  type PostId,
  type StatusId,
  type TagId,
  type CommentId,
  type MemberId,
} from '@quackback/ids'
import { buildCommentTree } from '@/lib/shared'
import type {
  PublicPostListResult,
  RoadmapPost,
  RoadmapPostListResult,
  PublicPostDetail,
  PublicComment,
  PinnedComment,
} from './post.types'

interface AvatarData {
  imageBlob: Buffer | null
  imageType: string | null
  image: string | null
}

function computeAvatarUrl(data: AvatarData): string | null {
  if (data.imageBlob && data.imageType) {
    return `data:${data.imageType};base64,${Buffer.from(data.imageBlob).toString('base64')}`
  }
  return data.image ?? null
}

function parseJson<T>(value: string | T): T {
  return typeof value === 'string' ? JSON.parse(value) : value
}

function parseAvatarData(json: string | null): string | null {
  if (!json) return null
  const data = parseJson<{ blob?: string; type?: string; url?: string }>(json)
  if (data.blob && data.type) {
    return `data:${data.type};base64,${data.blob}`
  }
  return data.url ?? null
}

type SortOrder = 'top' | 'new' | 'trending'

function getPostSortOrder(sort: SortOrder) {
  if (sort === 'new') return desc(posts.createdAt)
  if (sort === 'trending') {
    return sql`(${posts.voteCount} / GREATEST(1, EXTRACT(EPOCH FROM (NOW() - ${posts.createdAt})) / 86400)) DESC`
  }
  return desc(posts.voteCount)
}

export interface PostWithVotesAndAvatars {
  id: PostId
  title: string
  content: string | null
  statusId: StatusId | null
  voteCount: number
  commentCount: number
  authorName: string | null
  memberId: string | null
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
  const conditions = [eq(boards.isPublic, true)]

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
  params: PostListParams & { memberId?: MemberId }
): Promise<{ items: PostWithVotesAndAvatars[]; hasMore: boolean }> {
  const { sort = 'top', page = 1, limit = 20, memberId } = params
  const offset = (page - 1) * limit
  const conditions = buildPostFilterConditions(params)
  const orderBy = getPostSortOrder(sort)

  // Only authenticated users can vote, so we only check member_id
  // Anonymous users see vote counts but hasVoted is always false
  const memberUuid = memberId ? toUuid(memberId) : null
  const voteExistsSubquery = memberUuid
    ? sql<boolean>`EXISTS(
        SELECT 1 FROM ${votes}
        WHERE ${votes.postId} = ${posts.id}
        AND ${votes.memberId} = ${memberUuid}::uuid
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
      authorName: posts.authorName,
      memberId: posts.memberId,
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
      avatarData: sql<string | null>`(
        SELECT CASE
          WHEN u.image_blob IS NOT NULL AND u.image_type IS NOT NULL
          THEN json_build_object('blob', encode(u.image_blob, 'base64'), 'type', u.image_type)
          ELSE json_build_object('url', u.image)
        END
        FROM ${memberTable} m
        INNER JOIN ${userTable} u ON m.user_id = u.id
        WHERE m.id = ${posts.memberId}
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
      memberId: post.memberId,
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
      authorName: posts.authorName,
      memberId: posts.memberId,
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
    memberId: post.memberId,
    createdAt: post.createdAt,
    commentCount: post.commentCount,
    tags: parseJson<Array<{ id: TagId; name: string; color: string }>>(post.tagsJson),
    board: { id: post.boardId, name: post.boardName, slug: post.boardSlug },
  }))

  return { items, total: -1, hasMore }
}

export async function getPublicPostDetail(
  postId: PostId,
  memberId?: MemberId
): Promise<PublicPostDetail | null> {
  const postUuid = toUuid(postId)

  // Run post and comments queries in parallel (2 queries total)
  const [postResults, commentsWithReactions] = await Promise.all([
    // Query 1: Post with embedded tags, roadmaps, and author avatar
    db
      .select({
        id: posts.id,
        title: posts.title,
        content: posts.content,
        contentJson: posts.contentJson,
        statusId: posts.statusId,
        voteCount: posts.voteCount,
        authorName: posts.authorName,
        memberId: posts.memberId,
        createdAt: posts.createdAt,
        pinnedCommentId: posts.pinnedCommentId,
        officialResponse: posts.officialResponse,
        officialResponseAuthorName: posts.officialResponseAuthorName,
        officialResponseAt: posts.officialResponseAt,
        boardId: boards.id,
        boardName: boards.name,
        boardSlug: boards.slug,
        boardIsPublic: boards.isPublic,
        tagsJson: sql<string>`COALESCE(
          (SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color))
           FROM ${postTags} pt
           INNER JOIN ${tags} t ON t.id = pt.tag_id
           WHERE pt.post_id = ${posts.id}),
          '[]'
        )`.as('tags_json'),
        roadmapsJson: sql<string>`COALESCE(
          (SELECT json_agg(json_build_object('id', r.id, 'name', r.name, 'slug', r.slug))
           FROM ${postRoadmaps} pr
           INNER JOIN ${roadmaps} r ON r.id = pr.roadmap_id
           WHERE pr.post_id = ${posts.id} AND r.is_public = true),
          '[]'
        )`.as('roadmaps_json'),
        authorAvatarData: sql<string | null>`(
          SELECT CASE
            WHEN u.image_blob IS NOT NULL AND u.image_type IS NOT NULL
            THEN json_build_object('blob', encode(u.image_blob, 'base64'), 'type', u.image_type)
            ELSE json_build_object('url', u.image)
          END
          FROM ${memberTable} m
          INNER JOIN ${userTable} u ON m.user_id = u.id
          WHERE m.id = ${posts.memberId}
        )`.as('author_avatar_data'),
      })
      .from(posts)
      .innerJoin(boards, eq(posts.boardId, boards.id))
      .where(eq(posts.id, postId))
      .limit(1),

    // Query 2: Comments with avatars AND reactions (single query using GROUP BY + json_agg)
    // This is more elegant than separate queries + app-side join
    // Note: Raw SQL may return dates as strings depending on driver (neon-http vs postgres-js)
    db.execute<{
      id: string
      post_id: string
      parent_id: string | null
      member_id: string | null
      author_id: string | null
      author_name: string | null
      author_email: string | null
      content: string
      is_team_member: boolean
      created_at: Date | string
      deleted_at: Date | string | null
      image_blob: Buffer | null
      image_type: string | null
      image: string | null
      reactions_json: string
    }>(sql`
      SELECT
        c.id,
        c.post_id,
        c.parent_id,
        c.member_id,
        c.author_id,
        c.author_name,
        c.author_email,
        c.content,
        c.is_team_member,
        c.created_at,
        c.deleted_at,
        u.image_blob,
        u.image_type,
        u.image,
        COALESCE(
          json_agg(json_build_object('emoji', cr.emoji, 'memberId', cr.member_id))
          FILTER (WHERE cr.id IS NOT NULL),
          '[]'
        ) as reactions_json
      FROM ${comments} c
      LEFT JOIN ${memberTable} m ON c.member_id = m.id
      LEFT JOIN ${userTable} u ON m.user_id = u.id
      LEFT JOIN ${commentReactions} cr ON cr.comment_id = c.id
      WHERE c.post_id = ${postUuid}::uuid
      GROUP BY c.id, u.image_blob, u.image_type, u.image
      ORDER BY c.created_at ASC
    `),
  ])

  const postResult = postResults[0]
  if (!postResult || !postResult.boardIsPublic) {
    return null
  }

  const tagsResult = parseJson<Array<{ id: TagId; name: string; color: string }>>(
    postResult.tagsJson
  )
  const roadmapsResult = parseJson<Array<{ id: string; name: string; slug: string }>>(
    postResult.roadmapsJson
  )
  const authorAvatarUrl = parseAvatarData(postResult.authorAvatarData)

  // Extract rows from execute result (handles both postgres-js and neon-http formats)
  const commentsRaw = getExecuteRows<{
    id: string
    post_id: string
    parent_id: string | null
    member_id: string | null
    author_id: string | null
    author_name: string | null
    author_email: string | null
    content: string
    is_team_member: boolean
    created_at: Date | string
    deleted_at: Date | string | null
    image_blob: Buffer | null
    image_type: string | null
    image: string | null
    reactions_json: string
  }>(commentsWithReactions)

  // Helper to ensure Date objects (raw SQL may return strings depending on driver)
  const ensureDate = (value: Date | string): Date =>
    typeof value === 'string' ? new Date(value) : value

  // Map to expected format
  const commentsResult = commentsRaw.map((comment) => ({
    id: comment.id,
    postId: comment.post_id,
    parentId: comment.parent_id,
    memberId: comment.member_id,
    authorId: comment.author_id,
    authorName: comment.author_name,
    authorEmail: comment.author_email,
    content: comment.content,
    isTeamMember: comment.is_team_member,
    createdAt: ensureDate(comment.created_at),
    avatarUrl: computeAvatarUrl({
      imageBlob: comment.image_blob,
      imageType: comment.image_type,
      image: comment.image,
    }),
    reactions: parseJson<Array<{ emoji: string; memberId: string }>>(comment.reactions_json),
  }))

  const commentTree = buildCommentTree(commentsResult, memberId)

  const mapToPublicComment = (node: (typeof commentTree)[0]): PublicComment => ({
    id: node.id as CommentId,
    content: node.content,
    authorName: node.authorName,
    memberId: node.memberId,
    createdAt: node.createdAt,
    parentId: node.parentId as CommentId | null,
    isTeamMember: node.isTeamMember,
    avatarUrl: node.avatarUrl ?? null,
    replies: node.replies.map(mapToPublicComment),
    reactions: node.reactions,
  })

  const rootComments = commentTree.map(mapToPublicComment)

  let pinnedComment: PinnedComment | null = null
  if (postResult.pinnedCommentId) {
    const pinnedCommentData = commentsRaw.find((c) => c.id === postResult.pinnedCommentId)
    if (pinnedCommentData && !pinnedCommentData.deleted_at) {
      pinnedComment = {
        id: pinnedCommentData.id as CommentId,
        content: pinnedCommentData.content,
        authorName: pinnedCommentData.author_name,
        memberId: pinnedCommentData.member_id as MemberId | null,
        avatarUrl: computeAvatarUrl({
          imageBlob: pinnedCommentData.image_blob,
          imageType: pinnedCommentData.image_type,
          image: pinnedCommentData.image,
        }),
        createdAt: ensureDate(pinnedCommentData.created_at),
        isTeamMember: pinnedCommentData.is_team_member,
      }
    }
  }

  return {
    id: postResult.id,
    title: postResult.title,
    content: postResult.content,
    contentJson: postResult.contentJson,
    statusId: postResult.statusId,
    voteCount: postResult.voteCount,
    authorName: postResult.authorName,
    memberId: postResult.memberId,
    authorAvatarUrl,
    createdAt: postResult.createdAt,
    board: { id: postResult.boardId, name: postResult.boardName, slug: postResult.boardSlug },
    tags: tagsResult,
    roadmaps: roadmapsResult,
    comments: rootComments,
    officialResponse: postResult.officialResponse
      ? {
          content: postResult.officialResponse,
          authorName: postResult.officialResponseAuthorName,
          respondedAt: postResult.officialResponseAt!,
        }
      : null,
    pinnedComment,
    pinnedCommentId: (postResult.pinnedCommentId as CommentId) ?? null,
  }
}

export async function getPublicRoadmapPosts(statusIds: StatusId[]): Promise<RoadmapPost[]> {
  if (statusIds.length === 0) {
    return []
  }

  const result = await db
    .select({
      id: posts.id,
      title: posts.title,
      statusId: posts.statusId,
      voteCount: posts.voteCount,
      boardId: boards.id,
      boardName: boards.name,
      boardSlug: boards.slug,
    })
    .from(posts)
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .where(and(eq(boards.isPublic, true), inArray(posts.statusId, statusIds)))
    .orderBy(desc(posts.voteCount))

  return result.map((row) => ({
    id: row.id,
    title: row.title,
    statusId: row.statusId,
    voteCount: row.voteCount,
    board: {
      id: row.boardId,
      name: row.boardName,
      slug: row.boardSlug,
    },
  }))
}

export async function getPublicRoadmapPostsPaginated(params: {
  statusId: StatusId
  page?: number
  limit?: number
}): Promise<RoadmapPostListResult> {
  const { statusId, page = 1, limit = 10 } = params
  const offset = (page - 1) * limit

  const result = await db
    .select({
      id: posts.id,
      title: posts.title,
      statusId: posts.statusId,
      voteCount: posts.voteCount,
      boardId: boards.id,
      boardName: boards.name,
      boardSlug: boards.slug,
    })
    .from(posts)
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .where(and(eq(boards.isPublic, true), eq(posts.statusId, statusId)))
    .orderBy(desc(posts.voteCount))
    .limit(limit + 1)
    .offset(offset)

  const hasMore = result.length > limit
  const trimmedResults = hasMore ? result.slice(0, limit) : result

  const items = trimmedResults.map((row) => ({
    id: row.id,
    title: row.title,
    statusId: row.statusId,
    voteCount: row.voteCount,
    board: {
      id: row.boardId,
      name: row.boardName,
      slug: row.boardSlug,
    },
  }))

  return {
    items,
    total: -1,
    hasMore,
  }
}

export async function hasUserVoted(postId: PostId, memberId: MemberId): Promise<boolean> {
  const vote = await db.query.votes.findFirst({
    where: and(eq(votes.postId, postId), eq(votes.memberId, memberId)),
  })
  return !!vote
}

/**
 * Safely extract rows from db.execute() result.
 * Handles both postgres-js (array directly) and neon-http ({ rows: [...] }) formats.
 */
function getExecuteRows<T>(result: unknown): T[] {
  if (
    result &&
    typeof result === 'object' &&
    'rows' in result &&
    Array.isArray((result as { rows: unknown }).rows)
  ) {
    return (result as { rows: T[] }).rows
  }
  if (Array.isArray(result)) {
    return result as T[]
  }
  return []
}

/**
 * Combined query to get vote status AND subscription status in a single DB round-trip.
 * This replaces calling hasUserVoted() and getSubscriptionStatus() separately.
 *
 * Uses a LEFT JOIN approach to guarantee exactly 1 row is returned, avoiding
 * the need for a fallback query when no subscription exists.
 */
export async function getVoteAndSubscriptionStatus(
  postId: PostId,
  memberId: MemberId
): Promise<{
  hasVoted: boolean
  subscription: {
    subscribed: boolean
    level: 'all' | 'status_only' | 'none'
    reason: string | null
  }
}> {
  // Convert TypeIDs to UUIDs for raw SQL
  const postUuid = toUuid(postId)
  const memberUuid = toUuid(memberId)

  // Single query that always returns exactly 1 row using a subquery approach
  // This avoids the need for a fallback query when no subscription exists
  const result = await db.execute(sql`
    SELECT
      EXISTS(
        SELECT 1 FROM ${votes}
        WHERE ${votes.postId} = ${postUuid}::uuid
        AND ${votes.memberId} = ${memberUuid}::uuid
      ) as has_voted,
      ps.post_id IS NOT NULL as subscribed,
      ps.notify_comments,
      ps.notify_status_changes,
      ps.reason
    FROM (SELECT 1) AS dummy
    LEFT JOIN ${postSubscriptions} ps
      ON ps.post_id = ${postUuid}::uuid
      AND ps.member_id = ${memberUuid}::uuid
  `)

  type ResultRow = {
    has_voted: boolean
    subscribed: boolean
    notify_comments: boolean | null
    notify_status_changes: boolean | null
    reason: string | null
  }
  const rows = getExecuteRows<ResultRow>(result)
  const row = rows[0]

  // Determine subscription level from flags
  let level: 'all' | 'status_only' | 'none' = 'none'
  if (row?.subscribed) {
    if (row.notify_comments && row.notify_status_changes) {
      level = 'all'
    } else if (row.notify_status_changes) {
      level = 'status_only'
    }
  }

  return {
    hasVoted: row?.has_voted ?? false,
    subscription: {
      subscribed: row?.subscribed ?? false,
      level,
      reason: row?.reason ?? null,
    },
  }
}

export async function getUserVotedPostIds(
  postIds: PostId[],
  memberId: MemberId
): Promise<Set<PostId>> {
  if (postIds.length === 0) {
    return new Set()
  }
  const result = await db
    .select({ postId: votes.postId })
    .from(votes)
    .where(and(inArray(votes.postId, postIds), eq(votes.memberId, memberId)))
  return new Set(result.map((r) => r.postId))
}

export async function getAllUserVotedPostIds(memberId: MemberId): Promise<Set<PostId>> {
  const result = await db
    .select({ postId: votes.postId })
    .from(votes)
    .where(eq(votes.memberId, memberId))
  return new Set(result.map((r) => r.postId))
}

export async function getVotedPostIdsByUserId(
  userId: import('@quackback/ids').UserId
): Promise<Set<PostId>> {
  const result = await db
    .select({ postId: votes.postId })
    .from(votes)
    .innerJoin(memberTable, eq(votes.memberId, memberTable.id))
    .where(eq(memberTable.userId, userId))
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
