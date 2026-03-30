import {
  db,
  eq,
  and,
  sql,
  isNull,
  posts,
  boards,
  postTags,
  tags,
  comments,
  commentReactions,
  postStatuses,
  postRoadmaps,
  roadmaps,
  principal as principalTable,
} from '@/lib/server/db'
import { toUuid, type PostId, type CommentId, type PrincipalId } from '@quackback/ids'
import { buildCommentTree, toStatusChange } from '@/lib/shared'
import type { PublicPostDetail, PublicComment, PinnedComment } from './post.types'
import { resolveAvatarUrl, parseJson, parseAvatarData } from './post.public'
import { getExecuteRows } from '@/lib/server/utils'

export async function getPublicPostDetail(
  postId: PostId,
  principalId?: PrincipalId,
  options?: { includePrivateComments?: boolean }
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
        principalId: posts.principalId,
        createdAt: posts.createdAt,
        pinnedCommentId: posts.pinnedCommentId,
        isCommentsLocked: posts.isCommentsLocked,
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
        authorName: sql<string | null>`(
          SELECT m.display_name FROM ${principalTable} m
          WHERE m.id = ${posts.principalId}
        )`.as('author_name'),
        authorAvatarData: sql<string | null>`(
          SELECT CASE
            WHEN m.avatar_key IS NOT NULL
            THEN json_build_object('key', m.avatar_key)
            ELSE json_build_object('url', m.avatar_url)
          END
          FROM ${principalTable} m
          WHERE m.id = ${posts.principalId}
        )`.as('author_avatar_data'),
      })
      .from(posts)
      .innerJoin(boards, eq(posts.boardId, boards.id))
      .where(and(eq(posts.id, postId), isNull(posts.deletedAt)))
      .limit(1),

    // Query 2: Comments with avatars, reactions, and status changes (single query using GROUP BY + json_agg)
    // Note: Raw SQL may return dates as strings depending on driver (neon-http vs postgres-js)
    db.execute<{
      id: string
      post_id: string
      parent_id: string | null
      principal_id: string
      author_name: string | null
      content: string
      is_team_member: boolean
      is_private: boolean
      created_at: Date | string
      deleted_at: Date | string | null
      deleted_by_principal_id: string | null
      avatar_key: string | null
      avatar_url: string | null
      reactions_json: string
      sc_from_name: string | null
      sc_from_color: string | null
      sc_to_name: string | null
      sc_to_color: string | null
    }>(sql`
      SELECT
        c.id,
        c.post_id,
        c.parent_id,
        c.principal_id,
        m.display_name as author_name,
        c.content,
        c.is_team_member,
        c.is_private,
        c.created_at,
        c.deleted_at,
        c.deleted_by_principal_id,
        m.avatar_key,
        m.avatar_url,
        COALESCE(
          json_agg(json_build_object('emoji', cr.emoji, 'principalId', cr.principal_id))
          FILTER (WHERE cr.id IS NOT NULL),
          '[]'
        ) as reactions_json,
        scf.name as sc_from_name,
        scf.color as sc_from_color,
        sct.name as sc_to_name,
        sct.color as sc_to_color
      FROM ${comments} c
      INNER JOIN ${principalTable} m ON c.principal_id = m.id
      LEFT JOIN ${commentReactions} cr ON cr.comment_id = c.id
      LEFT JOIN ${postStatuses} scf ON scf.id = c.status_change_from_id
      LEFT JOIN ${postStatuses} sct ON sct.id = c.status_change_to_id
      WHERE c.post_id IN (
        SELECT ${postUuid}::uuid
        UNION ALL
        SELECT p.id FROM ${posts} p
        WHERE p.canonical_post_id = ${postUuid}::uuid AND p.deleted_at IS NULL
      )
      ${options?.includePrivateComments ? sql`` : sql`AND c.is_private = false`}
      GROUP BY c.id, m.display_name, m.avatar_key, m.avatar_url, scf.name, scf.color, sct.name, sct.color
      ORDER BY c.created_at ASC
    `),
  ])

  const postResult = postResults[0]
  if (!postResult || !postResult.boardIsPublic) {
    return null
  }

  const tagsResult = parseJson<
    Array<{ id: import('@quackback/ids').TagId; name: string; color: string }>
  >(postResult.tagsJson)
  const roadmapsResult = parseJson<Array<{ id: string; name: string; slug: string }>>(
    postResult.roadmapsJson
  )
  const authorAvatarUrl = parseAvatarData(postResult.authorAvatarData)

  // Extract rows from execute result (handles both postgres-js and neon-http formats)
  const commentsRaw = getExecuteRows<{
    id: string
    post_id: string
    parent_id: string | null
    principal_id: string
    author_name: string | null
    content: string
    is_team_member: boolean
    is_private: boolean
    created_at: Date | string
    deleted_at: Date | string | null
    deleted_by_principal_id: string | null
    avatar_key: string | null
    avatar_url: string | null
    reactions_json: string
    sc_from_name: string | null
    sc_from_color: string | null
    sc_to_name: string | null
    sc_to_color: string | null
  }>(commentsWithReactions)

  // Helper to ensure Date objects (raw SQL may return strings depending on driver)
  const ensureDate = (value: Date | string): Date =>
    typeof value === 'string' ? new Date(value) : value

  // Map to expected format
  const commentsResult = commentsRaw.map((comment) => ({
    id: comment.id,
    postId: comment.post_id,
    parentId: comment.parent_id,
    principalId: comment.principal_id,
    authorName: comment.author_name,
    content: comment.content,
    isTeamMember: comment.is_team_member,
    isPrivate: comment.is_private,
    createdAt: ensureDate(comment.created_at),
    deletedAt: comment.deleted_at ? ensureDate(comment.deleted_at) : null,
    deletedByPrincipalId: comment.deleted_by_principal_id,
    avatarUrl: resolveAvatarUrl({
      avatarKey: comment.avatar_key,
      avatarUrl: comment.avatar_url,
    }),
    statusChange: toStatusChange(
      comment.sc_from_name ? { name: comment.sc_from_name, color: comment.sc_from_color! } : null,
      comment.sc_to_name ? { name: comment.sc_to_name, color: comment.sc_to_color! } : null
    ),
    reactions: parseJson<Array<{ emoji: string; principalId: string }>>(comment.reactions_json),
  }))

  // Raw SQL returns principal_id as UUIDs, but principalId from auth is a TypeID.
  // Convert to UUID so aggregateReactions can match the current user's reactions.
  const principalUuid = principalId ? toUuid(principalId) : undefined
  const commentTree = buildCommentTree(commentsResult, principalUuid, {
    pruneDeleted: !options?.includePrivateComments,
  })

  const mapToPublicComment = (node: (typeof commentTree)[0]): PublicComment => {
    const deleted = !!node.deletedAt
    return {
      id: node.id as CommentId,
      content: deleted ? '' : node.content,
      authorName: deleted ? null : node.authorName,
      principalId: deleted ? null : node.principalId,
      createdAt: node.createdAt,
      deletedAt: node.deletedAt,
      isRemovedByTeam:
        deleted && !!node.deletedByPrincipalId && node.deletedByPrincipalId !== node.principalId,
      parentId: node.parentId as CommentId | null,
      isTeamMember: deleted ? false : node.isTeamMember,
      isPrivate: node.isPrivate,
      avatarUrl: deleted ? null : (node.avatarUrl ?? null),
      statusChange: deleted ? null : (node.statusChange ?? null),
      replies: node.replies.map(mapToPublicComment),
      reactions: deleted ? [] : node.reactions,
    }
  }

  const rootComments = commentTree.map(mapToPublicComment)

  let pinnedComment: PinnedComment | null = null
  if (postResult.pinnedCommentId) {
    const pinnedCommentData = commentsRaw.find((c) => c.id === postResult.pinnedCommentId)
    if (pinnedCommentData && !pinnedCommentData.deleted_at) {
      pinnedComment = {
        id: pinnedCommentData.id as CommentId,
        content: pinnedCommentData.content,
        authorName: pinnedCommentData.author_name,
        principalId: pinnedCommentData.principal_id as PrincipalId,
        avatarUrl: resolveAvatarUrl({
          avatarKey: pinnedCommentData.avatar_key,
          avatarUrl: pinnedCommentData.avatar_url,
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
    principalId: postResult.principalId,
    authorAvatarUrl,
    createdAt: postResult.createdAt,
    board: { id: postResult.boardId, name: postResult.boardName, slug: postResult.boardSlug },
    tags: tagsResult,
    roadmaps: roadmapsResult,
    comments: rootComments,
    pinnedComment,
    pinnedCommentId: pinnedComment ? (postResult.pinnedCommentId as CommentId) : null,
    isCommentsLocked: postResult.isCommentsLocked,
  }
}
