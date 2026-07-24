import {
  db,
  eq,
  and,
  sql,
  isNull,
  posts,
  boards,
  postTagAssignments,
  postTags,
  postComments,
  postCommentReactions,
  postStatuses,
  principal as principalTable,
} from '@/lib/server/db'
import { toUuid, fromUuid, type PostId, type PostCommentId, type PrincipalId } from '@quackback/ids'
import { buildCommentTree, toStatusChange } from '@/lib/shared'
import type { PublicPostDetail, PublicComment, PinnedComment } from './post.types'
import { DEFAULT_COMMENT_PAGE_SIZE, encodeCommentCursor, decodeCommentCursor } from './comment-page'
import { resolveAvatarUrl, parseJson, parseAvatarData } from './post.public'
import { getExecuteRows } from '@/lib/server/utils'
import {
  canViewPost,
  isTeamActor,
  postViewFilter,
  ANONYMOUS_ACTOR,
  type Actor,
} from '@/lib/server/policy'
import { hydrateMentions } from './hydrate-mentions'
import type { TiptapContent } from '@/lib/shared/db-types'
import type { JSONContent } from '@tiptap/core'

/**
 * Fetch the public-facing detail view for a post.
 *
 * The `actor` drives both visibility (via canViewPost) AND comment-private
 * filtering: team actors see `is_private` comments, non-team actors don't.
 * The `principalId` (for highlighting your own comments) is also derived
 * from the actor — anonymous viewers pass undefined.
 *
 * Previously these were three separate parameters that callers had to
 * keep in sync; threading actor consolidates them so the caller can't
 * accidentally pass an admin actor with `includePrivateComments=false`
 * and silently hide rows that should appear.
 */
/**
 * Per-actor allowlist of post ids that have been merged into a given
 * canonical and whose board the actor is entitled to view.
 *
 * The post-detail comments query unions in comments from every merged
 * source — without this filter, a team-only post merged into a public
 * canonical would leak its comments under the canonical's public detail.
 * Callers (currently only `getPublicPostDetail`) pre-compute the allowed
 * id list and pass it into the comments IN-clause directly.
 */
export async function listViewableMergedSourceIds(
  canonicalPostId: PostId,
  actor: Actor
): Promise<string[]> {
  // Push the audience + moderation gate into SQL via the existing
  // `postViewFilter(actor)` predicate so the database returns only
  // rows the actor is entitled to see. Previously the helper pulled
  // every merged-source row + every board.audience for the canonical
  // and filtered them in JS — for a heavily-merged canonical that's
  // N rows pulled per public-detail load even when N-1 of them are
  // immediately discarded. The SQL filter is the same one the public
  // list/detail queries use, so this also keeps the two view paths
  // in lockstep.
  const rows = await db
    .select({ id: posts.id })
    .from(posts)
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .where(
      and(
        eq(posts.canonicalPostId, canonicalPostId),
        isNull(posts.deletedAt),
        isNull(boards.deletedAt),
        postViewFilter(actor)
      )
    )
  return rows.map((r) => String(r.id))
}

export interface CommentPageParams {
  /** Root comments per page (default {@link DEFAULT_COMMENT_PAGE_SIZE}). */
  limit?: number
  /** Opaque keyset cursor from a prior page's `commentsNextCursor`. */
  cursor?: string | null
}

export async function getPublicPostDetail(
  postId: PostId,
  actor: Actor = ANONYMOUS_ACTOR,
  commentsPage: CommentPageParams = {}
): Promise<PublicPostDetail | null> {
  const postUuid = toUuid(postId)
  const principalId = (actor.principalId ?? undefined) as PrincipalId | undefined
  const includePrivateComments = isTeamActor(actor)

  const rootLimit = Math.max(1, commentsPage.limit ?? DEFAULT_COMMENT_PAGE_SIZE)
  const cursor = decodeCommentCursor(commentsPage.cursor)

  // Comment moderation visibility:
  //   - team actors see every moderation state (queue + published)
  //   - non-team actors only see 'published' comments, PLUS their own
  //     'pending' comments (mirrors policy.posts.canViewPost's
  //     own-pending escape hatch — authors can see their held content).
  //   - anonymous viewers (no principalId) see only 'published'.
  //
  // Built as raw SQL fragments so they can be interpolated into the two
  // execute() blocks below. The principalId is passed as a uuid param to
  // match the post_comments.principal_id column type.
  const ownPendingPrincipalUuid = principalId ? toUuid(principalId) : null
  const moderationFilterSql = includePrivateComments
    ? sql``
    : ownPendingPrincipalUuid
      ? sql`AND (c.moderation_state = 'published' OR (c.moderation_state = 'pending' AND c.principal_id = ${ownPendingPrincipalUuid}::uuid))`
      : sql`AND c.moderation_state = 'published'`

  // Pre-compute which merged-source posts the actor is entitled to see.
  // Runs in parallel with the post + comments fetch so we don't pay an
  // extra round-trip. Team actors trivially get every id. Without this
  // filter, the canonical's public detail would leak comments posted on
  // team-only or segment-restricted boards that were later merged in.
  const [postResults, viewableMergedSourceIds] = await Promise.all([
    // Query 1: Post with embedded tags and author avatar
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
        eta: posts.eta,
        pinnedCommentId: posts.pinnedCommentId,
        isCommentsLocked: posts.isCommentsLocked,
        boardId: boards.id,
        boardName: boards.name,
        boardSlug: boards.slug,
        boardAccess: boards.access,
        postModerationState: posts.moderationState,
        postPrincipalId: posts.principalId,
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
      // isNull(boards.deletedAt) blocks posts on a soft-deleted board
      // from being read by id — soft-delete intent applies to both the
      // post and the board it lives on. Without this, a deleted-board
      // post stayed reachable via its direct URL.
      .where(and(eq(posts.id, postId), isNull(posts.deletedAt), isNull(boards.deletedAt)))
      .limit(1),

    // Query 2: Per-actor merged-source allowlist. Computed in parallel with
    // the post fetch so we don't pay an extra round-trip. The comment set is
    // the UNION of the canonical post plus every merged source the actor may
    // see — paginating over that union (below) keeps merged threads correct.
    // Returns [] when this isn't a canonical or no sources survive the check.
    listViewableMergedSourceIds(postId, actor),
  ])

  const postResult = postResults[0]
  if (!postResult) {
    return null
  }

  // Authorize the read through policy.posts.canViewPost. This gates:
  //   - boards with non-public audience (team, authenticated, segments)
  //   - posts in non-published moderationState for non-authors and non-team
  // The 404-on-deny shape matches the previous behaviour (don't leak
  // existence to unauthorized callers).
  const viewDecision = canViewPost(
    actor,
    { moderationState: postResult.postModerationState, principalId: postResult.postPrincipalId },
    { access: postResult.boardAccess }
  )
  if (!viewDecision.allowed) {
    return null
  }

  const tagsResult = parseJson<
    Array<{ id: import('@quackback/ids').PostTagId; name: string; color: string }>
  >(postResult.tagsJson)
  const authorAvatarUrl = parseAvatarData(postResult.authorAvatarData)

  type CommentRow = {
    id: string
    post_id: string
    parent_id: string | null
    principal_id: string
    author_name: string | null
    content: string
    content_json: unknown
    is_team_member: boolean
    is_private: boolean
    created_at: Date | string
    updated_at: Date | string | null
    deleted_at: Date | string | null
    deleted_by_principal_id: string | null
    avatar_key: string | null
    avatar_url: string | null
    reactions_json: string
    sc_from_name: string | null
    sc_from_color: string | null
    sc_to_name: string | null
    sc_to_color: string | null
  }

  // The comment set is the UNION of this post + every merged source the actor
  // may view. All comment queries below range over that same id list so the
  // keyset cursor is coherent across merged threads.
  const commentPostUuids = [postUuid, ...viewableMergedSourceIds.map((id) => toUuid(id as PostId))]
  const postIdInList = sql.join(
    commentPostUuids.map((u) => sql`${u}::uuid`),
    sql`, `
  )

  // Shared SELECT for a hydrated comment row (author, reactions, status change).
  // `whereExtra` narrows to roots-for-this-page vs replies-for-those-roots.
  const commentSelect = (whereExtra: ReturnType<typeof sql>, orderLimit: ReturnType<typeof sql>) =>
    db.execute<CommentRow>(sql`
      SELECT
        c.id, c.post_id, c.parent_id, c.principal_id,
        m.display_name as author_name,
        c.content, c.content_json, c.is_team_member, c.is_private,
        c.created_at, c.updated_at, c.deleted_at, c.deleted_by_principal_id,
        m.avatar_key, m.avatar_url,
        COALESCE(
          json_agg(json_build_object('emoji', cr.emoji, 'principalId', cr.principal_id))
          FILTER (WHERE cr.id IS NOT NULL),
          '[]'
        ) as reactions_json,
        scf.name as sc_from_name, scf.color as sc_from_color,
        sct.name as sc_to_name, sct.color as sc_to_color
      FROM ${postComments} c
      INNER JOIN ${principalTable} m ON c.principal_id = m.id
      LEFT JOIN ${postCommentReactions} cr ON cr.comment_id = c.id
      LEFT JOIN ${postStatuses} scf ON scf.id = c.status_change_from_id
      LEFT JOIN ${postStatuses} sct ON sct.id = c.status_change_to_id
      WHERE c.post_id IN (${postIdInList})
      ${includePrivateComments ? sql`` : sql`AND c.is_private = false`}
      ${moderationFilterSql}
      ${whereExtra}
      GROUP BY c.id, m.display_name, m.avatar_key, m.avatar_url, scf.name, scf.color, sct.name, sct.color
      ${orderLimit}
    `)

  // Keyset over ROOT comments on (created_at, id) DESCENDING — page 1 is the
  // NEWEST roots, matching the newest-first thread UI; "show more" walks toward
  // older roots. Fetch limit+1 to detect a further page without a second count.
  // The cursor row itself is excluded via the strict `<` tuple compare.
  const cursorSql = cursor
    ? sql`AND (c.created_at, c.id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
    : sql``
  const rootRowsResult = await commentSelect(
    sql`AND c.parent_id IS NULL ${cursorSql}`,
    sql`ORDER BY c.created_at DESC, c.id DESC LIMIT ${rootLimit + 1}`
  )
  const rootRowsRaw = getExecuteRows<CommentRow>(rootRowsResult)
  const commentsHasMore = rootRowsRaw.length > rootLimit
  const pageRootRows = commentsHasMore ? rootRowsRaw.slice(0, rootLimit) : rootRowsRaw

  // Replies for exactly the roots on this page. Reply chains are shallow, so a
  // single descendants-of-these-roots pass (recursive CTE) is bounded by the
  // page's fan-out and keeps arbitrarily-deep chains attached.
  const rootUuids = pageRootRows.map((r) => r.id)
  let replyRowsRaw: CommentRow[] = []
  if (rootUuids.length > 0) {
    const rootIdInList = sql.join(
      rootUuids.map((u) => sql`${u}::uuid`),
      sql`, `
    )
    const replyRowsResult = await commentSelect(
      sql`AND c.parent_id IS NOT NULL AND c.id IN (
        WITH RECURSIVE descendants AS (
          SELECT id FROM ${postComments} WHERE parent_id IN (${rootIdInList})
          UNION
          SELECT ch.id FROM ${postComments} ch
          INNER JOIN descendants d ON ch.parent_id = d.id
        )
        SELECT id FROM descendants
      )`,
      sql`ORDER BY c.created_at ASC, c.id ASC`
    )
    replyRowsRaw = getExecuteRows<CommentRow>(replyRowsResult)
  }

  // Total live root count for the "show N more" label. Deleted roots that the
  // portal prunes are excluded so the count matches what the viewer can act on.
  const totalRootResult = await db.execute<{ count: string | number }>(sql`
    SELECT COUNT(*)::int as count
    FROM ${postComments} c
    WHERE c.post_id IN (${postIdInList})
      AND c.parent_id IS NULL
      ${includePrivateComments ? sql`` : sql`AND c.is_private = false`}
      ${includePrivateComments ? sql`` : sql`AND c.deleted_at IS NULL`}
      ${moderationFilterSql}
  `)
  const totalRootRows = getExecuteRows<{ count: string | number }>(totalRootResult)
  const commentsTotalRootCount = Number(totalRootRows[0]?.count ?? 0)

  const commentsNextCursor =
    commentsHasMore && pageRootRows.length > 0
      ? encodeCommentCursor(
          pageRootRows[pageRootRows.length - 1].created_at,
          pageRootRows[pageRootRows.length - 1].id
        )
      : null

  // Roots for this page + their descendants, ordered chronologically so
  // buildCommentTree nests them correctly.
  const commentsRaw = [...pageRootRows, ...replyRowsRaw].sort((a, b) => {
    const at = a.created_at instanceof Date ? a.created_at : new Date(a.created_at)
    const bt = b.created_at instanceof Date ? b.created_at : new Date(b.created_at)
    return at.getTime() - bt.getTime()
  })

  // Helper to ensure Date objects (raw SQL may return strings depending on driver)
  const ensureDate = (value: Date | string): Date =>
    typeof value === 'string' ? new Date(value) : value

  // Raw SQL returns id columns as UUIDs (no TypeID encoder in the path),
  // but the rest of the pipeline — public API contract, the post's
  // pinnedCommentId, the client mutations — speaks TypeIDs. Normalize
  // UUIDs → TypeIDs here so:
  //   1. the pinnedCommentId === c.id lookup below actually matches
  //      (regression that hid every pinned comment from the public API)
  //   2. clients receive the documented `comment_…` / `principal_…`
  //      shape and can round-trip it back into pin/react/reply mutations
  const commentsResult = commentsRaw.map((comment) => ({
    id: fromUuid('post_comment', comment.id) as PostCommentId,
    postId: fromUuid('post', comment.post_id) as PostId,
    parentId: comment.parent_id
      ? (fromUuid('post_comment', comment.parent_id) as PostCommentId)
      : null,
    principalId: fromUuid('principal', comment.principal_id) as PrincipalId,
    authorName: comment.author_name,
    content: comment.content,
    contentJson:
      (comment.content_json as import('@/lib/shared/db-types').TiptapContent | null | undefined) ??
      null,
    isTeamMember: comment.is_team_member,
    isPrivate: comment.is_private,
    createdAt: ensureDate(comment.created_at),
    updatedAt: comment.updated_at ? ensureDate(comment.updated_at) : null,
    deletedAt: comment.deleted_at ? ensureDate(comment.deleted_at) : null,
    deletedByPrincipalId: comment.deleted_by_principal_id
      ? (fromUuid('principal', comment.deleted_by_principal_id) as PrincipalId)
      : null,
    avatarUrl: resolveAvatarUrl({
      avatarKey: comment.avatar_key,
      avatarUrl: comment.avatar_url,
    }),
    statusChange: toStatusChange(
      comment.sc_from_name ? { name: comment.sc_from_name, color: comment.sc_from_color! } : null,
      comment.sc_to_name ? { name: comment.sc_to_name, color: comment.sc_to_color! } : null
    ),
    reactions: parseJson<Array<{ emoji: string; principalId: string }>>(comment.reactions_json).map(
      (r) => ({ emoji: r.emoji, principalId: fromUuid('principal', r.principalId) as PrincipalId })
    ),
  }))

  const commentTree = buildCommentTree(commentsResult, principalId, {
    pruneDeleted: !includePrivateComments,
  })

  const mapToPublicComment = (node: (typeof commentTree)[0]): PublicComment => {
    const deleted = !!node.deletedAt
    return {
      id: node.id as PostCommentId,
      content: deleted ? '' : node.content,
      contentJson: deleted
        ? null
        : ((node.contentJson as PublicComment['contentJson'] | null | undefined) ?? null),
      authorName: deleted ? null : node.authorName,
      principalId: deleted ? null : node.principalId,
      createdAt: node.createdAt,
      deletedAt: node.deletedAt,
      isRemovedByTeam:
        deleted && !!node.deletedByPrincipalId && node.deletedByPrincipalId !== node.principalId,
      parentId: node.parentId as PostCommentId | null,
      isTeamMember: deleted ? false : node.isTeamMember,
      isPrivate: node.isPrivate,
      isEdited: !deleted && !!node.updatedAt,
      avatarUrl: deleted ? null : (node.avatarUrl ?? null),
      statusChange: deleted ? null : (node.statusChange ?? null),
      replies: node.replies.map(mapToPublicComment),
      reactions: deleted ? [] : node.reactions,
    }
  }

  const rootComments = commentTree.map(mapToPublicComment)

  // Re-resolve mention chips against the current principal.displayName so
  // renamed users show up-to-date names. List views skip this; only the
  // detail read paths pay the extra round-trip.
  const hydratePublicCommentTree = async (node: PublicComment): Promise<PublicComment> => {
    const hydratedContentJson = node.contentJson
      ? ((await hydrateMentions(node.contentJson as JSONContent)) as PublicComment['contentJson'])
      : node.contentJson
    const hydratedReplies = await Promise.all(node.replies.map(hydratePublicCommentTree))
    return { ...node, contentJson: hydratedContentJson, replies: hydratedReplies }
  }
  const hydratedRootComments = await Promise.all(rootComments.map(hydratePublicCommentTree))

  let pinnedComment: PinnedComment | null = null
  if (postResult.pinnedCommentId) {
    // The pinned comment must render regardless of which page it falls on, so
    // resolve it independently of the paginated set. Prefer the already-loaded
    // page row (common: pins are usually recent/top), else fetch it directly.
    const pinnedUuid = toUuid(postResult.pinnedCommentId)
    let pinnedRow = commentsRaw.find((c) => c.id === pinnedUuid) ?? null
    if (!pinnedRow) {
      const pinnedResult = await commentSelect(sql`AND c.id = ${pinnedUuid}::uuid`, sql``)
      pinnedRow = getExecuteRows<CommentRow>(pinnedResult)[0] ?? null
    }
    if (pinnedRow && !pinnedRow.deleted_at) {
      const pinnedContentJson =
        (pinnedRow.content_json as PinnedComment['contentJson'] | null | undefined) ?? null
      const pinnedHydrated = pinnedContentJson
        ? ((await hydrateMentions(
            pinnedContentJson as JSONContent
          )) as PinnedComment['contentJson'])
        : null
      pinnedComment = {
        id: fromUuid('post_comment', pinnedRow.id) as PostCommentId,
        content: pinnedRow.content,
        contentJson: pinnedHydrated,
        authorName: pinnedRow.author_name,
        principalId: fromUuid('principal', pinnedRow.principal_id) as PrincipalId,
        avatarUrl: resolveAvatarUrl({
          avatarKey: pinnedRow.avatar_key,
          avatarUrl: pinnedRow.avatar_url,
        }),
        createdAt: ensureDate(pinnedRow.created_at),
        isTeamMember: pinnedRow.is_team_member,
      }
    }
  }

  const hydratedPostContentJson = postResult.contentJson
    ? ((await hydrateMentions(postResult.contentJson as JSONContent)) as TiptapContent | null)
    : postResult.contentJson

  return {
    id: postResult.id,
    title: postResult.title,
    content: postResult.content,
    contentJson: hydratedPostContentJson,
    statusId: postResult.statusId,
    voteCount: postResult.voteCount,
    authorName: postResult.authorName,
    principalId: postResult.principalId,
    authorAvatarUrl,
    createdAt: postResult.createdAt,
    eta: postResult.eta,
    board: { id: postResult.boardId, name: postResult.boardName, slug: postResult.boardSlug },
    // Server-only: fetchPublicPostDetail derives canVote/canComment from this
    // and strips it before the response reaches the client.
    boardAccess: postResult.boardAccess,
    tags: tagsResult,
    comments: hydratedRootComments,
    commentsHasMore,
    commentsNextCursor,
    commentsTotalRootCount,
    pinnedComment,
    pinnedCommentId: pinnedComment ? (postResult.pinnedCommentId as PostCommentId) : null,
    isCommentsLocked: postResult.isCommentsLocked,
  }
}
