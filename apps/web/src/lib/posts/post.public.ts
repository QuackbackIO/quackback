import {
  db,
  eq,
  and,
  inArray,
  desc,
  asc,
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
  member as memberTable,
  user as userTable,
} from '@/lib/db'
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
  // Run post and comments queries in parallel (faster than single complex query)
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
    // Query 2: Comments with avatars and reactions
    db
      .select({
        id: comments.id,
        postId: comments.postId,
        parentId: comments.parentId,
        memberId: comments.memberId,
        authorId: comments.authorId,
        authorName: comments.authorName,
        authorEmail: comments.authorEmail,
        content: comments.content,
        isTeamMember: comments.isTeamMember,
        createdAt: comments.createdAt,
        deletedAt: comments.deletedAt,
        imageBlob: userTable.imageBlob,
        imageType: userTable.imageType,
        image: userTable.image,
        reactionsJson: sql<string>`COALESCE(
          (SELECT json_agg(json_build_object('emoji', cr.emoji, 'memberId', cr.member_id))
           FROM ${commentReactions} cr
           WHERE cr.comment_id = ${comments.id}),
          '[]'
        )`.as('reactions_json'),
      })
      .from(comments)
      .leftJoin(memberTable, eq(comments.memberId, memberTable.id))
      .leftJoin(userTable, eq(memberTable.userId, userTable.id))
      .where(eq(comments.postId, postId))
      .orderBy(asc(comments.createdAt)),
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

  const commentsResult = commentsWithReactions.map((comment) => ({
    id: comment.id,
    postId: comment.postId,
    parentId: comment.parentId,
    memberId: comment.memberId,
    authorId: comment.authorId,
    authorName: comment.authorName,
    authorEmail: comment.authorEmail,
    content: comment.content,
    isTeamMember: comment.isTeamMember,
    createdAt: comment.createdAt,
    avatarUrl: computeAvatarUrl(comment),
    reactions: parseJson<Array<{ emoji: string; memberId: string }>>(comment.reactionsJson),
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
    const pinnedCommentData = commentsWithReactions.find((c) => c.id === postResult.pinnedCommentId)
    if (pinnedCommentData && !pinnedCommentData.deletedAt) {
      pinnedComment = {
        id: pinnedCommentData.id as CommentId,
        content: pinnedCommentData.content,
        authorName: pinnedCommentData.authorName,
        memberId: pinnedCommentData.memberId,
        avatarUrl: computeAvatarUrl(pinnedCommentData),
        createdAt: pinnedCommentData.createdAt,
        isTeamMember: pinnedCommentData.isTeamMember,
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
