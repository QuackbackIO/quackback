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
import type { PostId, StatusId, TagId, CommentId } from '@quackback/ids'
import { buildCommentTree } from '@/lib/shared'
import type {
  PublicPostListResult,
  RoadmapPost,
  RoadmapPostListResult,
  PublicPostDetail,
  PublicComment,
  PinnedComment,
} from './post.types'

function computeAvatarUrl(data: {
  imageBlob: Buffer | null
  imageType: string | null
  image: string | null
}): string | null {
  if (data.imageBlob && data.imageType) {
    const base64 = Buffer.from(data.imageBlob).toString('base64')
    return `data:${data.imageType};base64,${base64}`
  }
  return data.image ?? null
}

function getPostSortOrder(sort: 'top' | 'new' | 'trending') {
  switch (sort) {
    case 'new':
      return desc(posts.createdAt)
    case 'trending':
      return sql`(${posts.voteCount} / GREATEST(1, EXTRACT(EPOCH FROM (NOW() - ${posts.createdAt})) / 86400)) DESC`
    case 'top':
    default:
      return desc(posts.voteCount)
  }
}

export async function listPublicPosts(params: {
  boardSlug?: string
  search?: string
  statusIds?: StatusId[]
  statusSlugs?: string[]
  tagIds?: TagId[]
  sort?: 'top' | 'new' | 'trending'
  page?: number
  limit?: number
}): Promise<PublicPostListResult> {
  const {
    boardSlug,
    search,
    statusIds,
    statusSlugs,
    tagIds,
    sort = 'top',
    page = 1,
    limit = 20,
  } = params
  const offset = (page - 1) * limit

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
    })
    .from(posts)
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(limit + 1)
    .offset(offset)

  const hasMore = postsResult.length > limit
  const trimmedResults = hasMore ? postsResult.slice(0, limit) : postsResult

  const postIds = trimmedResults.map((p) => p.id)

  const tagsResult =
    postIds.length > 0
      ? await db
          .select({
            postId: postTags.postId,
            id: tags.id,
            name: tags.name,
            color: tags.color,
          })
          .from(postTags)
          .innerJoin(tags, eq(tags.id, postTags.tagId))
          .where(inArray(postTags.postId, postIds))
      : []

  const tagsByPost = new Map<PostId, Array<{ id: TagId; name: string; color: string }>>()
  for (const row of tagsResult) {
    const existing = tagsByPost.get(row.postId) || []
    existing.push({ id: row.id, name: row.name, color: row.color })
    tagsByPost.set(row.postId, existing)
  }

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
    tags: tagsByPost.get(post.id) || [],
    board: {
      id: post.boardId,
      name: post.boardName,
      slug: post.boardSlug,
    },
  }))

  return {
    items,
    total: -1,
    hasMore,
  }
}

export async function getPublicPostDetail(
  postId: PostId,
  userIdentifier?: string
): Promise<PublicPostDetail | null> {
  const postResult = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
    with: {
      board: true,
    },
  })

  if (!postResult || !postResult.board.isPublic) {
    return null
  }

  const [authorAvatarData, tagsResult, roadmapsResult, commentsWithAvatars] = await Promise.all([
    postResult.memberId
      ? db
          .select({
            imageBlob: userTable.imageBlob,
            imageType: userTable.imageType,
            image: userTable.image,
          })
          .from(memberTable)
          .innerJoin(userTable, eq(memberTable.userId, userTable.id))
          .where(eq(memberTable.id, postResult.memberId))
          .limit(1)
      : Promise.resolve([]),

    db
      .select({
        id: tags.id,
        name: tags.name,
        color: tags.color,
      })
      .from(postTags)
      .innerJoin(tags, eq(tags.id, postTags.tagId))
      .where(eq(postTags.postId, postId)),

    db
      .select({
        id: roadmaps.id,
        name: roadmaps.name,
        slug: roadmaps.slug,
      })
      .from(postRoadmaps)
      .innerJoin(roadmaps, eq(roadmaps.id, postRoadmaps.roadmapId))
      .where(and(eq(postRoadmaps.postId, postId), eq(roadmaps.isPublic, true))),

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
      })
      .from(comments)
      .leftJoin(memberTable, eq(comments.memberId, memberTable.id))
      .leftJoin(userTable, eq(memberTable.userId, userTable.id))
      .where(eq(comments.postId, postId))
      .orderBy(asc(comments.createdAt)),
  ])

  const authorAvatarUrl = authorAvatarData.length > 0 ? computeAvatarUrl(authorAvatarData[0]) : null

  const commentIds = commentsWithAvatars.map((c) => c.id)
  const reactionsResult =
    commentIds.length > 0
      ? await db.query.commentReactions.findMany({
          where: inArray(commentReactions.commentId, commentIds),
        })
      : []

  const reactionsByComment = new Map<string, Array<{ emoji: string; userIdentifier: string }>>()
  for (const reaction of reactionsResult) {
    const existing = reactionsByComment.get(reaction.commentId) || []
    existing.push({ emoji: reaction.emoji, userIdentifier: reaction.userIdentifier })
    reactionsByComment.set(reaction.commentId, existing)
  }

  const commentsResult = commentsWithAvatars.map((comment) => ({
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
    reactions: reactionsByComment.get(comment.id) || [],
  }))

  const commentTree = buildCommentTree(commentsResult, userIdentifier)

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
    const pinnedCommentData = commentsWithAvatars.find((c) => c.id === postResult.pinnedCommentId)
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
    board: {
      id: postResult.board.id,
      name: postResult.board.name,
      slug: postResult.board.slug,
    },
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

export async function hasUserVoted(postId: PostId, userIdentifier: string): Promise<boolean> {
  const vote = await db.query.votes.findFirst({
    where: and(eq(votes.postId, postId), eq(votes.userIdentifier, userIdentifier)),
  })

  return !!vote
}

export async function getUserVotedPostIds(
  postIds: PostId[],
  userIdentifier: string
): Promise<Set<PostId>> {
  if (postIds.length === 0) {
    return new Set()
  }

  const result = await db
    .select({ postId: votes.postId })
    .from(votes)
    .where(and(inArray(votes.postId, postIds), eq(votes.userIdentifier, userIdentifier)))

  return new Set(result.map((r) => r.postId))
}

export async function getAllUserVotedPostIds(userIdentifier: string): Promise<Set<PostId>> {
  const result = await db
    .select({ postId: votes.postId })
    .from(votes)
    .where(eq(votes.userIdentifier, userIdentifier))

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
