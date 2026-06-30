import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import {
  type PostId,
  type PrincipalId,
  type BoardId,
  type RoadmapId,
  type SegmentId,
  type StatusId,
  type TagId,
  type UserId,
} from '@quackback/ids'
import type { BoardSettings, BoardAccess } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy'
import {
  getOptionalAuth,
  hasAuthCredentials,
  policyActorFromAuth,
  requireAuth,
} from './auth-helpers'
import { NotFoundError } from '@/lib/shared/errors'
import { isTeamMember } from '@/lib/shared/roles'
import { db, principal as principalTable, user as userTable, eq, inArray } from '@/lib/server/db'
import { getPublicUrlOrNull } from '@/lib/server/storage/s3'
import {
  listPublicBoardsWithStats,
  getPublicBoardBySlug,
} from '@/lib/server/domains/boards/board.public'
import {
  listPublicPosts,
  listPublicPostsWithVotesAndAvatars,
  getVotedPostIdsByUserId,
} from '@/lib/server/domains/posts/post.public'
import { getPublicPostDetail } from '@/lib/server/domains/posts/post.public.detail'
import { getPostMergeInfo, getMergedPosts } from '@/lib/server/domains/posts/post.merge'
import { listPublicStatuses } from '@/lib/server/domains/statuses/status.service'
import { listPublicTags } from '@/lib/server/domains/tags/tag.service'
import { getSubscriptionStatus } from '@/lib/server/domains/subscriptions/subscription.service'
import { listPublicRoadmaps } from '@/lib/server/domains/roadmaps/roadmap.service'
import { getPublicRoadmapPosts } from '@/lib/server/domains/roadmaps/roadmap.query'
import { resolvePortalAccessForRequest } from './portal-access'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'portal' })

// Schemas
const sortSchema = z.enum(['top', 'new', 'trending'])

const fetchPublicPostsSchema = z.object({
  boardSlug: z.string().optional(),
  search: z.string().optional(),
  sort: sortSchema,
})

const fetchPortalDataSchema = z.object({
  boardSlug: z.string().optional(),
  search: z.string().optional(),
  sort: sortSchema,
  statusSlugs: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  userId: z.string().optional(),
  minVotes: z.number().int().min(1).optional(),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((s) => !Number.isNaN(new Date(s).getTime()), 'Invalid calendar date')
    .optional(),
  responded: z.enum(['responded', 'unresponded']).optional(),
})

/**
 * Build the per-board submit/vote capability map for `actor` from already-fetched
 * boards. Shared by fetchPortalData (feed SSR) and fetchBoardCapabilitiesFn (the
 * widget's Bearer refetch) so the shape + composition live in one place. The
 * caller passes `allowAnonymous` (and the boards) so it can parallelize the
 * settings read with its own queries.
 */
async function buildBoardPermissions(
  actor: Actor,
  boards: ReadonlyArray<{ id: string; access: BoardAccess }>,
  allowAnonymous: boolean
): Promise<Record<string, { canSubmit: boolean; canVote: boolean }>> {
  const { boardCapabilitiesForActor } = await import('@/lib/server/policy')
  const map: Record<string, { canSubmit: boolean; canVote: boolean }> = {}
  for (const b of boards) {
    const caps = boardCapabilitiesForActor(actor, b.access, allowAnonymous)
    map[b.id] = { canSubmit: caps.canSubmit, canVote: caps.canVote }
  }
  return map
}

/**
 * Fail-closed workspace anonymous-interaction ceiling for the capability gates.
 * Reads the RAW config (not getPortalConfig's permissive merged default) so a
 * missing `features.allowAnonymous` denies — keeping the advertised capability
 * in lockstep with the fail-closed write gates, so the UI can't out-advertise
 * what the server permits (#191). Existing tenants carry an explicit value from
 * migration 0084.
 */
async function loadAllowAnonymous(): Promise<boolean> {
  const { getSettings } = await import('./workspace')
  const { workspaceAllowsAnonymous } = await import('@/lib/server/domains/settings/settings.types')
  const settings = await getSettings()
  return workspaceAllowsAnonymous(settings?.portalConfig)
}

export const getPrincipalIdForUser = createServerFn({ method: 'GET' })
  .validator(z.object({ userId: z.string() }))
  .handler(async ({ data }): Promise<PrincipalId | null> => {
    log.debug({ user_id: data.userId }, 'get principal id for user')
    try {
      const record = await db.query.principal.findFirst({
        where: eq(principalTable.userId, data.userId as UserId),
      })
      return record?.id ?? null
    } catch (error) {
      log.error({ err: error }, 'get principal id for user failed')
      throw error
    }
  })

export const fetchPortalData = createServerFn({ method: 'GET' })
  .validator(fetchPortalDataSchema)
  .handler(async ({ data }) => {
    log.debug({ board_slug: data.boardSlug, sort: data.sort }, 'fetch portal data')

    // Outer gate: a private portal serves no boards/posts/statuses/tags to a
    // caller the portal-access resolver denies. The per-board audience filter
    // below stays as the inner layer for granted callers.
    const access = await resolvePortalAccessForRequest()
    if (!access.granted) {
      log.debug('portal access denied, returning empty')
      return {
        boards: [],
        posts: { items: [], hasMore: false, total: 0 },
        statuses: [],
        tags: [],
        votedPostIds: [],
        principalId: null,
      }
    }

    // Resolve the policy actor from the current session before fanning out the
    // parallel queries. List helpers default to ANONYMOUS_ACTOR; we pass the
    // real one so signed-in users and segment members see audience-restricted
    // boards + their own pending posts.
    const auth = await getOptionalAuth()
    const actor = await policyActorFromAuth(auth)

    // Run ALL queries in parallel for maximum performance — including the
    // (fail-closed) anonymous-ceiling read so buildBoardPermissions doesn't
    // serialize an extra round-trip onto this (highest-traffic) loader.
    const [memberResult, boardsRaw, postsResult, statuses, tags, allVotedPosts, allowAnonymous] =
      await Promise.all([
        // Principal lookup (needed for principalId in response)
        data.userId
          ? db.query.principal.findFirst({
              where: eq(principalTable.userId, data.userId as UserId),
              columns: { id: true },
            })
          : null,
        listPublicBoardsWithStats(actor),
        // Posts WITHOUT embedded vote check (we get votes separately for parallelism)
        listPublicPostsWithVotesAndAvatars({
          actor,
          boardSlug: data.boardSlug,
          search: data.search,
          statusSlugs: data.statusSlugs,
          tagIds: data.tagIds as TagId[] | undefined,
          sort: data.sort,
          page: 1,
          limit: 20,
          minVotes: data.minVotes,
          dateFrom: data.dateFrom,
          responded: data.responded,
        }),
        listPublicStatuses(),
        listPublicTags(),
        // Get ALL voted post IDs for this user (runs in parallel, we'll filter to displayed posts)
        data.userId
          ? getVotedPostIdsByUserId(data.userId as UserId)
          : Promise.resolve(new Set<PostId>()),
        loadAllowAnonymous(),
      ])
    const principalId = memberResult?.id ?? null

    // Per-board submit/vote capability for THIS viewer, composed with the
    // workspace anonymous switch. The UI uses these booleans to decide whether
    // to advertise the submit/vote CTAs instead of re-deriving from the
    // workspace flag and showing an action the per-board tier rejects (#191).
    // Keyed by board id: vote permission is per-board, so this one map also
    // covers infinite-scroll feed pages (every post belongs to one of these
    // boards). Computed in-memory from boardsRaw.access — no extra query.
    const boardPermissions = await buildBoardPermissions(actor, boardsRaw, allowAnonymous)

    // Return ALL voted post IDs (not just page 1) so infinite scroll pages show correct vote state
    const votedPostIds = Array.from(allVotedPosts)

    const posts = {
      items: postsResult.items.map((post) => ({
        id: post.id,
        title: post.title,
        content: post.content,
        statusId: post.statusId,
        voteCount: post.voteCount,
        authorName: post.authorName,
        principalId: post.principalId,
        createdAt: post.createdAt.toISOString(),
        commentCount: post.commentCount,
        tags: post.tags,
        board: post.board,
      })),
      hasMore: postsResult.hasMore,
      total: -1,
    }

    return {
      // Strip the internal access matrix (segment ids, per-action tiers,
      // moderation rules) from the client payload — the UI gates via
      // boardPermissions / boardCapabilitiesForActor and never reads
      // board.access, so shipping it would leak segmentation structure (#191).
      boards: boardsRaw.map(({ access: _access, ...b }) => ({
        ...b,
        settings: (b.settings ?? {}) as BoardSettings,
      })),
      posts,
      statuses,
      tags,
      votedPostIds,
      principalId,
      boardPermissions,
    }
  })

export const fetchPublicBoards = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch public boards')
  try {
    // Outer gate: private portal + unauthorized caller → no boards.
    const access = await resolvePortalAccessForRequest()
    if (!access.granted) {
      log.debug('portal access denied, returning empty')
      return []
    }

    const auth = await getOptionalAuth()
    const actor = await policyActorFromAuth(auth)
    const boards = await listPublicBoardsWithStats(actor)
    // Strip the internal access matrix (see fetchPortalData) — clients never
    // read board.access, so it must not reach the public payload (#191).
    return boards.map(({ access: _access, ...b }) => ({
      ...b,
      settings: (b.settings ?? {}) as BoardSettings,
    }))
  } catch (error) {
    log.error({ err: error }, 'fetch public boards failed')
    throw error
  }
})

export const fetchPublicBoardBySlug = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: z.string() }))
  .handler(async ({ data }) => {
    log.debug({ slug: data.slug }, 'fetch public board by slug')
    try {
      // Outer gate: private portal + unauthorized caller → no board.
      const access = await resolvePortalAccessForRequest()
      if (!access.granted) {
        log.debug('portal access denied, returning null')
        return null
      }

      // Direct-load lookup must honour the request actor — otherwise an
      // authenticated/segment-member user navigating directly to the slug
      // is denied a board they can see in the portal list. Without the
      // actor, the helper defaults to ANONYMOUS_ACTOR and only public
      // boards round-trip.
      const auth = await getOptionalAuth()
      const actor = await policyActorFromAuth(auth)
      const board = await getPublicBoardBySlug(data.slug, actor)
      if (!board) return null
      // Strip the internal access matrix (see fetchPortalData) before serializing.
      const { access: _access, ...rest } = board
      return { ...rest, settings: (rest.settings ?? {}) as BoardSettings }
    } catch (error) {
      log.error({ err: error }, 'fetch public board by slug failed')
      throw error
    }
  })

export const fetchPublicPostDetail = createServerFn({ method: 'GET' })
  .validator(z.object({ postId: z.string() }))
  .handler(async ({ data }) => {
    log.debug({ post_id: data.postId }, 'fetch public post detail')

    // Outer gate: a private portal serves no post detail to a caller the
    // portal-access resolver denies. The per-board audience check inside
    // getPublicPostDetail stays as the inner layer for granted callers.
    const access = await resolvePortalAccessForRequest()
    if (!access.granted) {
      log.debug('portal access denied, returning null')
      return null
    }

    // The policy actor is the sole input getPublicPostDetail needs:
    // it drives the visibility check, the principalId-for-own-comments
    // lookup, and the include-private-comments flag (derived from
    // isTeamActor). Same resolution path as list reads.
    const auth = hasAuthCredentials() ? await getOptionalAuth() : null
    const actor = await policyActorFromAuth(auth)
    const result = await getPublicPostDetail(data.postId as PostId, actor)

    if (!result) return null

    // Helper to safely convert Date or string to ISO string
    // Raw SQL may return dates as strings depending on the driver
    const toISOString = (date: Date | string): string =>
      typeof date === 'string' ? date : date.toISOString()

    type CommentType = (typeof result.comments)[0]
    type SerializedComment = Omit<CommentType, 'createdAt' | 'replies'> & {
      createdAt: string
      replies: SerializedComment[]
    }
    function serializeComment(c: CommentType): SerializedComment {
      return {
        ...c,
        createdAt: toISOString(c.createdAt),
        replies: c.replies.map(serializeComment),
      }
    }

    // Fetch merge info for this post. Pass the same actor used to gate
    // the post detail above so the canonical's audience check runs from
    // the caller's perspective — without it, the canonical's title and
    // board slug could leak through the merge banner. The workspace anonymous
    // switch (only needed to ceiling a non-user actor) is fetched alongside so
    // its DB read overlaps the merge queries instead of running in series.
    const postId = data.postId as PostId
    const needsAnonCeiling = actor.principalType !== 'user'
    const [mergeInfo, mergedPostsList, allowAnonymous] = await Promise.all([
      getPostMergeInfo(postId, actor).then((info) =>
        info ? { ...info, mergedAt: toISOString(info.mergedAt) } : null
      ),
      getMergedPosts(postId),
      needsAnonCeiling ? loadAllowAnonymous() : Promise.resolve(false),
    ])

    // Per-board vote/comment capability for THIS viewer. The widget passes its
    // Bearer identity to this fn and refetches on identify, so `actor` reflects
    // the real (possibly just-identified) viewer — unlike the home feed, which
    // only has the anonymous SSR baseline. boardCapabilitiesForActor applies the
    // per-board tier + the workspace anonymous ceiling (non-user actors only),
    // so the UI never advertises a vote/comment CTA the board's tier rejects
    // (#191). canSubmit is unused on the detail view.
    const { boardCapabilitiesForActor } = await import('@/lib/server/policy')
    const { canVote, canComment } = boardCapabilitiesForActor(
      actor,
      result.boardAccess,
      allowAnonymous
    )

    // Drop boardAccess (server-only — used above to compute the booleans) so
    // the board's segment ids never reach the client.
    const { boardAccess: _boardAccess, ...serializable } = result
    return {
      ...serializable,
      contentJson: result.contentJson ?? {},
      createdAt: toISOString(result.createdAt),
      comments: result.comments.map(serializeComment),
      mergeInfo,
      mergedPostCount: mergedPostsList.length > 0 ? mergedPostsList.length : undefined,
      canVote,
      canComment,
    }
  })

export const fetchPublicPosts = createServerFn({ method: 'GET' })
  .validator(fetchPublicPostsSchema)
  .handler(async ({ data }) => {
    log.debug({ board_slug: data.boardSlug, sort: data.sort }, 'fetch public posts')
    try {
      // Outer gate: private portal + unauthorized caller → no posts.
      const access = await resolvePortalAccessForRequest()
      if (!access.granted) {
        log.debug('portal access denied, returning empty')
        return { items: [], hasMore: false, total: 0 }
      }

      const auth = await getOptionalAuth()
      const actor = await policyActorFromAuth(auth)
      const result = await listPublicPosts({ ...data, page: 1, limit: 20, actor })
      return {
        ...result,
        items: result.items.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
      }
    } catch (error) {
      log.error({ err: error }, 'fetch public posts failed')
      throw error
    }
  })

export const fetchPublicStatuses = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch public statuses')
  try {
    // Outer gate: a private portal must not expose its status taxonomy to a
    // denied caller.
    const access = await resolvePortalAccessForRequest()
    if (!access.granted) {
      log.debug('portal access denied, returning empty')
      return []
    }
    return await listPublicStatuses()
  } catch (error) {
    log.error({ err: error }, 'fetch public statuses failed')
    throw error
  }
})

export const fetchPublicTags = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch public tags')
  try {
    // Outer gate: a private portal must not expose its tag taxonomy to a
    // denied caller.
    const access = await resolvePortalAccessForRequest()
    if (!access.granted) {
      log.debug('portal access denied, returning empty')
      return []
    }
    return await listPublicTags()
  } catch (error) {
    log.error({ err: error }, 'fetch public tags failed')
    throw error
  }
})

export const fetchUserAvatar = createServerFn({ method: 'GET' })
  .validator(z.object({ userId: z.string(), fallbackImageUrl: z.string().nullable().optional() }))
  .handler(async ({ data }) => {
    log.debug({ user_id: data.userId }, 'fetch user avatar')
    try {
      const user = await db.query.user.findFirst({
        where: eq(userTable.id, data.userId as UserId),
        columns: { imageKey: true, image: true },
      })

      if (!user) return { avatarUrl: data.fallbackImageUrl ?? null, hasCustomAvatar: false }

      if (user.imageKey) {
        const avatarUrl = getPublicUrlOrNull(user.imageKey)
        if (avatarUrl) {
          return { avatarUrl, hasCustomAvatar: true }
        }
      }

      return { avatarUrl: user.image ?? data.fallbackImageUrl ?? null, hasCustomAvatar: false }
    } catch (error) {
      log.error({ err: error }, 'fetch user avatar failed')
      throw error
    }
  })

export const fetchAvatars = createServerFn({ method: 'GET' })
  .validator(z.array(z.string()))
  .handler(async ({ data }) => {
    log.debug({ count: data.length }, 'fetch avatars')
    try {
      const principalIds = (data as PrincipalId[]).filter((id): id is PrincipalId => id !== null)
      if (principalIds.length === 0) return {}

      const principals = await db
        .select({
          id: principalTable.id,
          avatarKey: principalTable.avatarKey,
          avatarUrl: principalTable.avatarUrl,
        })
        .from(principalTable)
        .where(inArray(principalTable.id, principalIds))

      const avatarMap = new Map<PrincipalId, string | null>()
      for (const p of principals) {
        const s3Url = p.avatarKey ? getPublicUrlOrNull(p.avatarKey) : null
        avatarMap.set(p.id, s3Url ?? p.avatarUrl)
      }
      for (const id of principalIds) {
        if (!avatarMap.has(id)) avatarMap.set(id, null)
      }

      return Object.fromEntries(avatarMap)
    } catch (error) {
      log.error({ err: error }, 'fetch avatars failed')
      throw error
    }
  })

export const fetchSubscriptionStatus = createServerFn({ method: 'GET' })
  .validator(z.object({ principalId: z.string(), postId: z.string() }))
  .handler(async ({ data }) => {
    log.debug({ principal_id: data.principalId, post_id: data.postId }, 'fetch subscription status')
    try {
      // The route used to accept a client-supplied principalId with no
      // auth check at all — a textbook IDOR. Lock the lookup to the
      // caller's own principal unless they're team. Team-role actors
      // can read any principal's subscription (admin support flow).
      const auth = await requireAuth()
      const requestedPrincipalId = data.principalId as PrincipalId
      const isTeam = auth.principal.role === 'admin' || auth.principal.role === 'member'
      if (!isTeam && requestedPrincipalId !== auth.principal.id) {
        // 404-shape so denied callers can't probe other users'
        // subscription state by varying principalId.
        throw new NotFoundError(
          'SUBSCRIPTION_NOT_FOUND',
          `Subscription not found for principal ${requestedPrincipalId}`
        )
      }
      // Audience gate: even the caller themselves shouldn't be able to
      // read a subscription tied to a post they can't view (the
      // subscribe path is also gated below, but a stale row from before
      // an audience change could otherwise leak the post's existence).
      const { assertPostViewable } = await import('@/lib/server/domains/posts/post.access')
      const actor = await policyActorFromAuth(auth)
      await assertPostViewable(data.postId as PostId, actor)
      return await getSubscriptionStatus(requestedPrincipalId, data.postId as PostId)
    } catch (error) {
      log.error({ err: error }, 'fetch subscription status failed')
      throw error
    }
  })

export const fetchPublicRoadmaps = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch public roadmaps')
  try {
    // Outer gate: private portal + unauthorized caller → no roadmaps.
    const access = await resolvePortalAccessForRequest()
    if (!access.granted) {
      log.debug('portal access denied, returning empty')
      return []
    }

    const roadmaps = await listPublicRoadmaps()
    return roadmaps.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      isPublic: r.isPublic,
      position: r.position,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }))
  } catch (error) {
    log.error({ err: error }, 'fetch public roadmaps failed')
    throw error
  }
})

export const fetchPublicRoadmapPosts = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      roadmapId: z.string(),
      statusId: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
      search: z.string().optional(),
      boardIds: z.array(z.string()).optional(),
      tagIds: z.array(z.string()).optional(),
      segmentIds: z.array(z.string()).optional(),
      sort: z.enum(['votes', 'newest', 'oldest']).optional(),
    })
  )
  .handler(async ({ data }) => {
    log.debug(
      { roadmap_id: data.roadmapId, limit: data.limit, offset: data.offset },
      'fetch public roadmap posts'
    )
    try {
      // Outer gate: private portal + unauthorized caller → no roadmap posts.
      const access = await resolvePortalAccessForRequest()
      if (!access.granted) {
        log.debug('portal access denied, returning empty')
        return { items: [], hasMore: false, total: 0 }
      }

      // Resolve auth once — used for both the segment-filter gate and
      // the per-board audience filter on getPublicRoadmapPosts.
      const auth = hasAuthCredentials() ? await getOptionalAuth() : null

      // Segment filtering requires admin/member role
      let segmentIds: SegmentId[] | undefined
      if (data.segmentIds?.length && auth && isTeamMember(auth.principal.role)) {
        segmentIds = data.segmentIds as SegmentId[]
        // Non-team callers silently ignore segmentIds
      }

      const actor = await policyActorFromAuth(auth)

      const result = await getPublicRoadmapPosts(
        data.roadmapId as RoadmapId,
        {
          statusId: data.statusId as StatusId | undefined,
          limit: data.limit ?? 20,
          offset: data.offset ?? 0,
          search: data.search,
          boardIds: data.boardIds as BoardId[] | undefined,
          tagIds: data.tagIds as TagId[] | undefined,
          segmentIds,
          sort: data.sort,
        },
        actor
      )

      return {
        ...result,
        items: result.items.map((item) => ({
          id: String(item.id),
          title: item.title,
          voteCount: item.voteCount,
          statusId: item.statusId ? String(item.statusId) : null,
          board: { id: String(item.board.id), name: item.board.name, slug: item.board.slug },
          roadmapEntry: {
            postId: String(item.roadmapEntry.postId),
            roadmapId: String(item.roadmapEntry.roadmapId),
            position: item.roadmapEntry.position,
          },
        })),
      }
    } catch (error) {
      log.error({ err: error }, 'fetch public roadmap posts failed')
      throw error
    }
  })

const getCommentsSectionDataSchema = z.object({ postId: z.string() })

export const getCommentsSectionDataFn = createServerFn({ method: 'GET' })
  .validator(getCommentsSectionDataSchema)
  .handler(async ({ data }) => {
    log.debug({ post_id: data.postId }, 'get comments section data')
    const denied = { isMember: false, isTeamMember: false, canComment: false, user: undefined }
    try {
      const postId = data.postId as PostId

      // Portal-visibility gate: a caller who can't see the portal must not
      // learn whether commenting is open. Mirrors getVoteSidebarDataFn.
      const access = await resolvePortalAccessForRequest()
      if (!access.granted) return denied

      const ctx = await getOptionalAuth()
      const actor = await policyActorFromAuth(ctx)

      // Per-post audience gate: a portal-granted caller can still be probing a
      // post on a team-only / segment-restricted board. NotFound => denial.
      try {
        const { assertPostViewable } = await import('@/lib/server/domains/posts/post.access')
        await assertPostViewable(postId, actor)
      } catch (err) {
        if (err instanceof Error && err.name === 'NotFoundError') return denied
        throw err
      }

      // Per-board comment capability for the real actor, composed with the
      // workspace anonymous ceiling. boardCapabilitiesForActor is the single
      // source of truth the portal + widget UIs share, so the CTA can't desync
      // from the server-side canCreateComment gate (it passes a published,
      // unlocked post internally — assertPostViewable already proved view, and
      // comments-locked is handled by the component's lockedMessage).
      const { loadBoardAccessForPost } = await import('@/lib/server/domains/posts/post.access')
      const { boardCapabilitiesForActor } = await import('@/lib/server/policy')
      const boardAccess = await loadBoardAccessForPost(postId)
      if (!boardAccess) return denied

      // The workspace anonymous ceiling only applies to non-user actors, so
      // only real anonymous / no-session viewers need the (uncached) config
      // read — a user actor's canComment is gated purely by the per-board tier,
      // making allowAnonymous irrelevant. Keep the read lazy + conditional
      // rather than eager so a user actor's path never depends on it.
      let allowAnonymous = false
      if (actor.principalType !== 'user') {
        allowAnonymous = await loadAllowAnonymous()
      }
      const canComment = boardCapabilitiesForActor(actor, boardAccess, allowAnonymous).canComment

      const isMember = !!(ctx?.user && ctx?.principal)
      const isTeamMember =
        isMember && (ctx.principal.role === 'admin' || ctx.principal.role === 'member')

      return {
        isMember,
        isTeamMember,
        canComment,
        user: isMember
          ? { name: ctx.user.name, email: ctx.user.email, principalId: ctx.principal.id }
          : undefined,
      }
    } catch (error) {
      log.error({ err: error }, 'get comments section data failed')
      throw error
    }
  })

/**
 * Per-board submit/vote capability map for the request actor.
 *
 * Same shape and computation as fetchPortalData.boardPermissions, but split out
 * so the widget can REFETCH it for the real (Bearer) identity. The widget feed
 * is seeded at SSR from the anonymous baseline (no Bearer at loader time); after
 * the visitor identifies it re-queries this with its Bearer token (keyed on
 * sessionVersion), so the feed gates votes/submission per the actual actor
 * instead of OR-ing in a blanket `isIdentified` — which would advertise CTAs on
 * segments/team boards the actor cannot act on (Codex #191 follow-up).
 *
 * Declared at the end of the module on purpose: the gate test maps portal
 * handlers by declaration order, so new server fns append here to avoid
 * shifting existing indices.
 */
export const fetchBoardCapabilitiesFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch board capabilities')
  const empty: Record<string, { canSubmit: boolean; canVote: boolean }> = {}

  // Same portal-visibility + per-board gates as fetchPortalData.
  const access = await resolvePortalAccessForRequest()
  if (!access.granted) return empty

  const auth = await getOptionalAuth()
  const actor = await policyActorFromAuth(auth)

  // Settings read overlaps the board query — only one DB round-trip is on the
  // critical path for this refetch-on-identify endpoint.
  const [boards, allowAnonymous] = await Promise.all([
    listPublicBoardsWithStats(actor),
    loadAllowAnonymous(),
  ])
  return buildBoardPermissions(actor, boards, allowAnonymous)
})
