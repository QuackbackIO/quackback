/**
 * Server functions for public post operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import {
  type PostId,
  type BoardId,
  type StatusId,
  type PostTagId,
  type PrincipalId,
  type RoadmapId,
  type UserId,
} from '@quackback/ids'
import { tiptapContentSchema } from '@/lib/shared/schemas/posts'
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'
import { getRequestHeaders } from '@tanstack/react-start/server'
import {
  getOptionalAuth,
  requireAuth,
  hasAuthCredentials,
  policyActorFromAuth,
} from './auth-helpers'
import { getSettings } from './workspace'
import { workspaceAllowsAnonymous } from '@/lib/server/domains/settings/settings.types'
import { listPublicPosts, getAllUserVotedPostIds } from '@/lib/server/domains/posts/post.public'
import {
  getPublicRoadmapPostsPaginated,
  getVoteAndSubscriptionStatus,
} from '@/lib/server/domains/posts/post.public.utils'
import { createPost } from '@/lib/server/domains/posts/post.service'
import { voteOnPost } from '@/lib/server/domains/posts/post.voting'
import { checkAnonVoteRateLimit } from '@/lib/server/utils/anon-rate-limit'
import { getPostPermissions } from '@/lib/server/domains/posts/post.permissions'
import { userEditPost, softDeletePost } from '@/lib/server/domains/posts/post.user-actions'
import { getPublicBoardById } from '@/lib/server/domains/boards/board.public'
import { getDefaultStatus } from '@/lib/server/domains/statuses/status.service'
import { getMemberByUser } from '@/lib/server/domains/principals/principal.service'
import { listPublicRoadmaps } from '@/lib/server/domains/roadmaps/roadmap.service'
import { getPublicRoadmapPosts } from '@/lib/server/domains/roadmaps/roadmap.query'
import { resolvePortalAccessForRequest } from './portal-access'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'public-posts' })

// ============================================
// Schemas
// ============================================

// tiptapContentSchema imported from shared schemas

const listPublicPostsSchema = z.object({
  boardSlug: z.string().optional(),
  search: z.string().optional(),
  statusIds: z.array(z.string()).optional(),
  statusSlugs: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  sort: z.enum(['top', 'new', 'trending']).optional().default('top'),
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(100).optional().default(20),
  minVotes: z.number().int().min(1).optional(),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((s) => !Number.isNaN(new Date(s).getTime()), 'Invalid calendar date')
    .optional(),
  responded: z.enum(['responded', 'unresponded']).optional(),
})

const getPostPermissionsSchema = z.object({
  postId: z.string(),
})

const userEditPostSchema = z.object({
  postId: z.string(),
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().max(10000),
  contentJson: tiptapContentSchema.optional(),
})

const userDeletePostSchema = z.object({
  postId: z.string(),
})

const toggleVoteSchema = z.object({
  postId: z.string(),
})

const createPublicPostSchema = z.object({
  boardId: z.string(),
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().max(10000).optional().default(''),
  contentJson: tiptapContentSchema.optional(),
  metadata: z.record(z.string(), z.string()).optional(),
})

const getPublicRoadmapPostsSchema = z.object({
  roadmapId: z.string(),
  statusId: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
})

const getRoadmapPostsByStatusSchema = z.object({
  statusId: z.string(),
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(100).optional().default(10),
})

const getVoteSidebarDataSchema = z.object({
  postId: z.string(),
})

// ============================================
// Type Exports
// ============================================

export type ListPublicPostsInput = z.infer<typeof listPublicPostsSchema>
export type GetPostPermissionsInput = z.infer<typeof getPostPermissionsSchema>
export type UserEditPostInput = z.infer<typeof userEditPostSchema>
export type UserDeletePostInput = z.infer<typeof userDeletePostSchema>
export type ToggleVoteInput = z.infer<typeof toggleVoteSchema>
export type CreatePublicPostInput = z.infer<typeof createPublicPostSchema>
export type GetPublicRoadmapPostsInput = z.infer<typeof getPublicRoadmapPostsSchema>
export type GetRoadmapPostsByStatusInput = z.infer<typeof getRoadmapPostsByStatusSchema>
export type GetVoteSidebarDataInput = z.infer<typeof getVoteSidebarDataSchema>

// ============================================
// Server Functions
// ============================================

/**
 * List public posts with filtering (no auth required).
 *
 * Portal-visibility gate: a private portal serves no posts to a caller the
 * portal-access resolver denies. The per-board audience filter inside
 * `listPublicPosts` still runs as the inner layer for granted callers.
 */
export const listPublicPostsFn = createServerFn({ method: 'GET' })
  .validator(listPublicPostsSchema)
  .handler(async ({ data }: { data: ListPublicPostsInput }) => {
    log.debug({ sort: data.sort, board_slug: data.boardSlug || 'all' }, 'list public posts')
    try {
      // Outer gate: private portal + unauthorized caller → no portal data.
      const access = await resolvePortalAccessForRequest()
      if (!access.granted) {
        log.debug('portal access denied, returning empty')
        return { items: [], hasMore: false, total: 0 }
      }

      // Resolve the actor so per-board audience + per-post moderation
      // filters apply from the caller's perspective. Without this,
      // listPublicPosts defaulted to ANONYMOUS_ACTOR and authenticated /
      // segment members saw only public-audience boards even when they
      // were entitled to more.
      const auth = await getOptionalAuth()
      const actor = await policyActorFromAuth(auth)

      const result = await listPublicPosts({
        boardSlug: data.boardSlug,
        search: data.search,
        statusIds: data.statusIds as StatusId[] | undefined,
        statusSlugs: data.statusSlugs,
        tagIds: data.tagIds as PostTagId[] | undefined,
        sort: data.sort,
        page: data.page,
        limit: data.limit,
        minVotes: data.minVotes,
        dateFrom: data.dateFrom,
        responded: data.responded,
        actor,
      })

      log.debug({ count: result.items.length }, 'list public posts results')
      // Serialize Date fields
      return {
        ...result,
        items: result.items.map((post) => ({
          ...post,
          createdAt: post.createdAt.toISOString(),
        })),
      }
    } catch (error) {
      log.error({ err: error }, 'list public posts failed')
      throw error
    }
  })

/**
 * Get edit/delete permissions for a post (optional auth).
 */
export const getPostPermissionsFn = createServerFn({ method: 'GET' })
  .validator(getPostPermissionsSchema)
  .handler(
    async ({
      data,
    }: {
      data: GetPostPermissionsInput
    }): Promise<{
      canEdit: boolean
      canDelete: boolean
      editReason?: string
      deleteReason?: string
    }> => {
      log.debug({ post_id: data.postId }, 'get post permissions')
      try {
        // Early bailout: no session cookie = no permissions (skip DB queries)
        if (!hasAuthCredentials()) {
          log.debug('no session cookie, skipping auth')
          return { canEdit: false, canDelete: false }
        }

        const ctx = await getOptionalAuth()
        const postId = data.postId as PostId

        // If no user/member, return no permissions
        if (!ctx?.user || !ctx?.principal) {
          log.debug('no auth context')
          return { canEdit: false, canDelete: false }
        }

        // Build actor info for permission checks
        const actor = {
          principalId: ctx.principal.id,
          role: ctx.principal.role,
        }

        // Combined permission check - queries post, config, and status only once
        const { canEdit, canDelete } = await getPostPermissions(postId, actor)

        log.debug(
          { can_edit: canEdit.allowed, can_delete: canDelete.allowed },
          'get post permissions results'
        )
        return {
          canEdit: canEdit.allowed,
          canDelete: canDelete.allowed,
          editReason: canEdit.reason,
          deleteReason: canDelete.reason,
        }
      } catch (error) {
        // Post not found or other error - return no permissions
        log.error({ err: error }, 'get post permissions failed')
        return { canEdit: false, canDelete: false }
      }
    }
  )

/**
 * User edits their own post.
 */
export const userEditPostFn = createServerFn({ method: 'POST' })
  .validator(userEditPostSchema)
  .handler(async ({ data }: { data: UserEditPostInput }) => {
    log.debug({ post_id: data.postId }, 'user edit post')
    try {
      // Portal-visibility gate — see toggleVoteFn / createPublicPostFn
      // for rationale. Denied callers must not mutate inside a portal
      // they can't view.
      const access = await resolvePortalAccessForRequest()
      if (!access.granted) {
        throw new Error('Portal access required')
      }
      const ctx = await requireAuth()
      const { postId: postIdRaw, title, content, contentJson } = data
      const postId = postIdRaw as PostId

      // Per-post audience gate — see assertPostViewable. The author-check
      // inside userEditPost is sufficient for "only the author edits",
      // but we still need to refuse to confirm existence to callers who
      // can't see the post under its board's audience.
      const { assertPostViewable } = await import('@/lib/server/domains/posts/post.access')
      const policyActor = await policyActorFromAuth(ctx)
      await assertPostViewable(postId, policyActor)

      // Build actor info for permission check
      const actor = {
        principalId: ctx.principal.id,
        role: ctx.principal.role,
      }

      const sanitizedContentJson = contentJson ? sanitizeTiptapContent(contentJson) : undefined
      const result = await userEditPost(
        postId,
        { title, content, contentJson: sanitizedContentJson },
        actor
      )

      log.info({ post_id: result.id }, 'user edited post')
      // Serialize Date fields
      return {
        ...result,
        createdAt: result.createdAt.toISOString(),
        updatedAt: result.updatedAt.toISOString(),
        deletedAt: result.deletedAt?.toISOString() || null,
      }
    } catch (error) {
      log.error({ err: error }, 'user edit post failed')
      throw error
    }
  })

/**
 * User soft-deletes their own post.
 */
export const userDeletePostFn = createServerFn({ method: 'POST' })
  .validator(userDeletePostSchema)
  .handler(async ({ data }: { data: UserDeletePostInput }) => {
    log.debug({ post_id: data.postId }, 'user delete post')
    try {
      // Portal-visibility gate — see toggleVoteFn / createPublicPostFn.
      const access = await resolvePortalAccessForRequest()
      if (!access.granted) {
        throw new Error('Portal access required')
      }
      const ctx = await requireAuth()
      const postId = data.postId as PostId

      // Per-post audience gate (404 on deny).
      const { assertPostViewable } = await import('@/lib/server/domains/posts/post.access')
      const policyActor = await policyActorFromAuth(ctx)
      await assertPostViewable(postId, policyActor)

      // Build actor info for permission check
      const actor = {
        principalId: ctx.principal.id,
        role: ctx.principal.role,
        userId: ctx.user.id,
      }

      await softDeletePost(postId, actor)

      log.info({ post_id: postId }, 'user deleted post')
      return { id: postId }
    } catch (error) {
      log.error({ err: error }, 'user delete post failed')
      throw error
    }
  })

/**
 * Toggle vote on a post. Requires authentication (including anonymous sessions).
 * Anonymous users sign in via Better Auth's anonymous plugin on the client side
 * before calling this function.
 */
export const toggleVoteFn = createServerFn({ method: 'POST' })
  .validator(toggleVoteSchema)
  .handler(
    async ({ data }: { data: ToggleVoteInput }): Promise<{ voted: boolean; voteCount: number }> => {
      log.debug({ post_id: data.postId }, 'toggle vote')
      try {
        // Portal-visibility gate: a denied caller (signed-in but not on
        // the allowlist of a private portal) must not be able to vote.
        // Read-side gating happens at list / detail; write paths need
        // the same check or the caller could mutate state from inside a
        // portal they're not entitled to view.
        const access = await resolvePortalAccessForRequest()
        if (!access.granted) {
          throw new Error('Portal access required')
        }
        const ctx = await requireAuth()
        // Per-post audience gate: portal-access alone is not enough — an
        // authenticated caller could still vote on a team-only / segment-
        // restricted post if they knew the id. `assertPostVotable`
        // composes view (404 on deny) + the per-board vote tier
        // (403 on "viewable but not votable").
        const { assertPostVotable } = await import('@/lib/server/domains/posts/post.access')
        const actor = await policyActorFromAuth(ctx)
        await assertPostVotable(data.postId as PostId, actor)

        // Block anonymous users unless the workspace allows anonymous
        // interaction. The per-board vote tier was already enforced
        // above by assertPostVotable; this is the workspace-wide
        // master switch (collapsed in migration 0084 from the legacy
        // anonymousVoting/Commenting/Posting trio).
        if (ctx.principal.type === 'anonymous') {
          // Fail closed on a missing flag — read the raw config, not
          // getPortalConfig's permissive merged default (matches
          // createPublicPostFn / the vote-sidebar gate). The per-board vote
          // tier was already enforced above by assertPostVotable.
          const settings = await getSettings()
          if (!workspaceAllowsAnonymous(settings?.portalConfig)) {
            throw new Error('Anonymous interaction is not enabled')
          }

          // Rate limit anonymous voters by IP
          const headers = getRequestHeaders()
          const ip =
            headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
            headers.get('x-real-ip') ||
            '0.0.0.0'
          if (!(await checkAnonVoteRateLimit(ip))) {
            throw new Error('Too many votes, please try again later')
          }
        }

        const result = await voteOnPost(data.postId as PostId, ctx.principal.id)
        log.debug(
          { voted: result.voted, count: result.voteCount, principal_type: ctx.principal.type },
          'toggle vote results'
        )
        return result
      } catch (error) {
        log.error({ err: error }, 'toggle vote failed')
        throw error
      }
    }
  )

/**
 * Create a post on a public board.
 */
export const createPublicPostFn = createServerFn({ method: 'POST' })
  .validator(createPublicPostSchema)
  .handler(async ({ data }: { data: CreatePublicPostInput }) => {
    log.debug({ board_id: data.boardId }, 'create public post')
    try {
      // Portal-visibility gate: a denied caller must not be able to
      // create posts inside a portal they're not entitled to view. The
      // per-board audience check inside getPublicBoardById still runs
      // as the inner layer for granted callers.
      const access = await resolvePortalAccessForRequest()
      if (!access.granted) {
        throw new Error('Portal access required')
      }
      const ctx = await requireAuth()
      const { boardId: boardIdRaw, title, content, contentJson, metadata } = data
      const boardId = boardIdRaw as BoardId

      // Resolve the actor first so getPublicBoardById can apply
      // canViewBoard internally — a "not found" framing for any
      // audience denial preserves the previous behaviour (don't leak
      // existence). createPost will re-check via canCreatePost with
      // the same actor, so this stays as defense in depth.
      const actor = await policyActorFromAuth(ctx)

      // Run remaining independent lookups in parallel
      const [board, principalRecord, defaultStatus, settings] = await Promise.all([
        getPublicBoardById(boardId, actor),
        getMemberByUser(ctx.user.id as UserId),
        getDefaultStatus(),
        getSettings(),
      ])

      if (!board) {
        throw new Error('Board not found')
      }

      if (!settings) {
        throw new Error('Organization settings not found')
      }

      // Block anonymous users unless the workspace master switch allows
      // anonymous interaction. Per-board submit tiers are checked
      // downstream inside createPost via canCreatePost; this is the
      // workspace-wide ceiling (collapsed in migration 0084).
      if (ctx.principal.type === 'anonymous') {
        // Fail closed on a missing flag (single source of truth; the per-board
        // submit tier is the inner gate, existing tenants carry an explicit
        // value from migration 0084).
        if (!workspaceAllowsAnonymous(settings.portalConfig)) {
          throw new Error('Anonymous interaction is not enabled')
        }
      } else if (!principalRecord) {
        throw new Error('You must be a member to submit feedback.')
      }

      // Build author info (use ctx.principal for anonymous users who don't have a member record)
      const author = {
        principalId: (principalRecord?.id ?? ctx.principal.id) as PrincipalId,
        userId: ctx.user.id as UserId,
        name: ctx.user.name || ctx.user.email,
        email: ctx.user.email,
        actor,
      }

      // Create the post (events dispatched by service layer)
      const post = await createPost(
        {
          boardId,
          title,
          content,
          contentJson: contentJson ? sanitizeTiptapContent(contentJson) : undefined,
          statusId: defaultStatus?.id,
          widgetMetadata: metadata,
        },
        author,
        { headers: getRequestHeaders() }
      )

      log.info({ post_id: post.id }, 'created public post')
      return {
        id: post.id,
        title: post.title,
        content: post.content,
        statusId: post.statusId,
        voteCount: post.voteCount,
        createdAt: post.createdAt.toISOString(),
        board: {
          id: board.id,
          name: board.name,
          slug: board.slug,
        },
      }
    } catch (error) {
      log.error({ err: error }, 'create public post failed')
      throw error
    }
  })

/**
 * Get all post IDs the user has voted on (optional auth, includes anonymous sessions).
 */
export const getVotedPostsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ votedPostIds: string[] }> => {
    log.debug('get voted posts')
    try {
      if (!hasAuthCredentials()) {
        log.debug('no session cookie, skipping auth')
        return { votedPostIds: [] }
      }

      const ctx = await getOptionalAuth()
      if (!ctx?.user || !ctx?.principal) {
        log.debug('no auth context')
        return { votedPostIds: [] }
      }

      const result = await getAllUserVotedPostIds(ctx.principal.id)
      log.debug({ count: result.size }, 'get voted posts results')
      return { votedPostIds: Array.from(result) }
    } catch (error) {
      log.error({ err: error }, 'get voted posts failed')
      throw error
    }
  }
)

/**
 * List public roadmaps for a workspace (no auth required).
 *
 * Portal-visibility gate: a private portal serves no roadmaps to a denied
 * caller.
 */
export const listPublicRoadmapsFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('list public roadmaps')
  try {
    // Outer gate: private portal + unauthorized caller → no portal data.
    const access = await resolvePortalAccessForRequest()
    if (!access.granted) {
      log.debug('portal access denied, returning empty')
      return []
    }

    // No auth needed - this is public data
    const result = await listPublicRoadmaps()

    log.debug({ count: result.length }, 'list public roadmaps results')
    // Serialize branded types to plain strings for turbo-stream
    return result.map((roadmap) => ({
      id: String(roadmap.id),
      name: roadmap.name,
      slug: roadmap.slug,
      description: roadmap.description,
      isPublic: roadmap.isPublic,
      position: roadmap.position,
      createdAt: roadmap.createdAt.toISOString(),
      updatedAt: roadmap.updatedAt.toISOString(),
    }))
  } catch (error) {
    log.error({ err: error }, 'list public roadmaps failed')
    throw error
  }
})

/**
 * Get posts for a public roadmap (no auth required).
 *
 * Portal-visibility gate: a private portal serves no roadmap posts to a
 * denied caller.
 */
export const getPublicRoadmapPostsFn = createServerFn({ method: 'GET' })
  .validator(getPublicRoadmapPostsSchema)
  .handler(async ({ data }: { data: GetPublicRoadmapPostsInput }) => {
    log.debug({ roadmap_id: data.roadmapId }, 'get public roadmap posts')
    try {
      // Outer gate: private portal + unauthorized caller → no portal data.
      const access = await resolvePortalAccessForRequest()
      if (!access.granted) {
        log.debug('portal access denied, returning empty')
        return { items: [], hasMore: false, total: 0 }
      }

      // Resolve actor so per-board audience filters apply — a team
      // member viewing the public roadmap should see posts from
      // team-only boards (since they're entitled), while an anonymous
      // viewer should not.
      const auth = await getOptionalAuth()
      const actor = await policyActorFromAuth(auth)

      const { roadmapId, statusId, limit, offset } = data

      const result = await getPublicRoadmapPosts(
        roadmapId as RoadmapId,
        {
          statusId: statusId as StatusId | undefined,
          limit,
          offset,
        },
        actor
      )
      log.debug({ count: result.items.length }, 'get public roadmap posts results')

      // Serialize branded types to plain strings for turbo-stream
      return {
        ...result,
        items: result.items.map((item) => ({
          id: String(item.id),
          title: item.title,
          voteCount: item.voteCount,
          statusId: item.statusId ? String(item.statusId) : null,
          board: {
            id: String(item.board.id),
            name: item.board.name,
            slug: item.board.slug,
          },
          roadmapEntry: {
            postId: String(item.roadmapEntry.postId),
            roadmapId: String(item.roadmapEntry.roadmapId),
            position: item.roadmapEntry.position,
          },
        })),
      }
    } catch (error) {
      log.error({ err: error }, 'get public roadmap posts failed')
      throw error
    }
  })

/**
 * Get paginated posts for roadmap view filtered by status (legacy).
 *
 * Portal-visibility gate: a private portal serves no roadmap posts to a
 * denied caller.
 */
export const getRoadmapPostsByStatusFn = createServerFn({ method: 'GET' })
  .validator(getRoadmapPostsByStatusSchema)
  .handler(async ({ data }: { data: GetRoadmapPostsByStatusInput }) => {
    log.debug({ status_id: data.statusId }, 'get roadmap posts by status')
    try {
      // Outer gate: private portal + unauthorized caller → no portal data.
      const access = await resolvePortalAccessForRequest()
      if (!access.granted) {
        log.debug('portal access denied, returning empty')
        return { items: [], hasMore: false, total: 0 }
      }

      // Resolve the actor so per-board audience + per-post moderation
      // filters apply. The legacy roadmap-by-status view used to default
      // to ANONYMOUS_ACTOR even for authenticated team members, hiding
      // posts on non-public boards they were entitled to see.
      const auth = await getOptionalAuth()
      const actor = await policyActorFromAuth(auth)

      const { statusId, page, limit } = data

      const result = await getPublicRoadmapPostsPaginated({
        statusId: statusId as StatusId,
        page,
        limit,
        actor,
      })
      log.debug({ count: result.items.length }, 'get roadmap posts by status result')

      // Serialize branded types to plain strings for turbo-stream
      return {
        ...result,
        items: result.items.map((item) => ({
          ...item,
          statusId: item.statusId ? String(item.statusId) : null,
        })),
      }
    } catch (error) {
      log.error({ err: error }, 'get roadmap posts by status failed')
      throw error
    }
  })

/**
 * Get vote sidebar data for a post (optional auth, supports anonymous sessions).
 * Returns membership status, vote ability, vote status, and subscription status.
 */
export const getVoteSidebarDataFn = createServerFn({ method: 'GET' })
  .validator(getVoteSidebarDataSchema)
  .handler(async ({ data }) => {
    log.debug({ post_id: data.postId }, 'get vote sidebar data')
    try {
      const postId = data.postId as PostId
      const noSub = { subscribed: false, level: 'none' as const, reason: null }
      const denied = { isMember: false, canVote: false, hasVoted: false, subscriptionStatus: noSub }

      // Portal-visibility gate: a caller who can't see the portal must
      // not learn whether they've voted, whether they're a member, or
      // anything about the post. Sibling write paths (toggleVoteFn,
      // createPublicPostFn) gate similarly; reads return the safe
      // default rather than throwing.
      const access = await resolvePortalAccessForRequest()
      if (!access.granted) {
        log.debug('portal access denied')
        return denied
      }

      // Per-post audience gate: portal-granted callers can still be
      // probing a post on a team-only / segment-restricted board. Treat
      // a NotFound from assertPostViewable as denial (same shape — the
      // sidebar UI degrades to the read-only state).
      const probeAuth = await getOptionalAuth()
      const probeActor = await policyActorFromAuth(probeAuth)
      try {
        const { assertPostViewable } = await import('@/lib/server/domains/posts/post.access')
        await assertPostViewable(postId, probeActor)
      } catch (err) {
        if (err instanceof Error && err.name === 'NotFoundError') {
          log.debug('post not viewable')
          return denied
        }
        throw err
      }

      // Per-board vote tier gate: a board can be public-to-view but
      // authenticated-only-to-vote (modern "Public" preset). Resolve the
      // board.access alongside the post and run canVotePost so the UI
      // can render the right CTA (sign-in prompt vs. enabled button)
      // instead of letting an anonymous click learn the truth on submit.
      // The workspace anonymousVoting flag is composed below as a ceiling.
      const { loadBoardAccessForPost } = await import('@/lib/server/domains/posts/post.access')
      const { canVotePost } = await import('@/lib/server/policy')
      const boardAccess = await loadBoardAccessForPost(postId)
      if (!boardAccess) {
        // Race: post or board deleted between assertPostViewable and now.
        log.debug('post or board vanished mid-call')
        return denied
      }

      // canVotePost composes canViewPost internally, but assertPostViewable
      // already proved view-allowed for this actor; pass moderationState=
      // 'published' here so the inner view check is a no-op and the
      // decision reflects the vote tier specifically.
      const voteDecision = canVotePost(
        probeActor,
        { moderationState: 'published', principalId: null },
        { access: boardAccess }
      )

      // No session cookie — fall back to the workspace anonymous master
      // switch (collapsed from the legacy anonymousVoting flag in
      // migration 0084). The per-board vote tier is the inner ceiling.
      if (!hasAuthCredentials()) {
        const settings = await getSettings()
        const anonEnabled = workspaceAllowsAnonymous(settings?.portalConfig)
        const canVote = anonEnabled && voteDecision.allowed
        log.debug(
          { can_vote: canVote, anon_enabled: anonEnabled, vote_allowed: voteDecision.allowed },
          'vote sidebar data, no session'
        )
        return {
          isMember: false,
          canVote,
          hasVoted: false,
          subscriptionStatus: noSub,
        }
      }

      // Has session (could be regular or anonymous)
      const ctx = await getOptionalAuth()
      if (!ctx?.user || !ctx?.principal) {
        log.debug('invalid session')
        return { isMember: false, canVote: false, hasVoted: false, subscriptionStatus: noSub }
      }

      const isAnonymous = ctx.principal.type === 'anonymous'

      // Re-check the workspace allowAnonymous master switch for existing
      // anonymous sessions (sign-in cookie present but principal is anon).
      let canVote = voteDecision.allowed
      if (isAnonymous) {
        const settings = await getSettings()
        const anonEnabled = workspaceAllowsAnonymous(settings?.portalConfig)
        canVote = anonEnabled && voteDecision.allowed
      }

      const { hasVoted, subscription } = await getVoteAndSubscriptionStatus(
        postId,
        ctx.principal.id
      )

      log.debug(
        { is_member: !isAnonymous, has_voted: hasVoted, can_vote: canVote },
        'vote sidebar data resolved'
      )
      return {
        isMember: !isAnonymous,
        canVote,
        hasVoted,
        subscriptionStatus: isAnonymous
          ? noSub
          : {
              subscribed: subscription.subscribed,
              level: subscription.level,
              reason: subscription.reason,
            },
      }
    } catch (error) {
      log.error({ err: error }, 'get vote sidebar data failed')
      throw error
    }
  })

// ============================================
// Similar Posts (Duplicate Detection)
// ============================================

const findSimilarPostsSchema = z.object({
  title: z.string().min(3).max(200),
  limit: z.number().int().min(1).max(10).optional().default(5),
})

/** Match strength categories for similar posts */
export type MatchStrength = 'strong' | 'good' | 'weak'

export interface SimilarPost {
  id: string
  title: string
  voteCount: number
  status: {
    name: string
    color: string
  } | null
  boardSlug: string
  /** How closely this matches the search (strong: 50%+, good: 40-50%, weak: 35-40%) */
  matchStrength: MatchStrength
}

/** Categorize similarity score into match strength */
function getMatchStrength(score: number): MatchStrength {
  if (score >= 0.5) return 'strong'
  if (score >= 0.4) return 'good'
  return 'weak'
}

/** Raw search result before enrichment */
interface RawSearchResult {
  id: string
  title: string
  voteCount: number
  statusId: string | null
  boardId: string
  score: number
}

/** Convert database row to raw result */
function toRawResult(row: {
  id: PostId | string
  title: string
  voteCount: number
  statusId: StatusId | string | null
  boardId: BoardId | string
  score: number
}): RawSearchResult {
  return {
    id: String(row.id),
    title: row.title,
    voteCount: row.voteCount,
    statusId: row.statusId ? String(row.statusId) : null,
    boardId: String(row.boardId),
    score: Number(row.score),
  }
}

/**
 * Find posts similar to the given title using hybrid search.
 * Combines semantic (vector) and keyword (full-text) search for best results.
 *
 * The vector search handles synonyms naturally through embeddings - the model
 * knows that "dark mode" ≈ "night theme" without needing explicit dictionaries.
 * FTS provides a boost for exact keyword matches.
 *
 * No auth required - this is a read-only helper for the post creation form.
 *
 * Portal-visibility gate: a private portal must not let a denied caller
 * enumerate post titles via this search. Team members (admin/member) using
 * the admin merge UI are granted by the resolver, so their use is unaffected.
 */
export const findSimilarPostsFn = createServerFn({ method: 'GET' })
  .validator(findSimilarPostsSchema)
  .handler(async ({ data }): Promise<SimilarPost[]> => {
    log.debug({ title_length: data.title.length }, 'find similar posts')
    try {
      // Outer gate: private portal + unauthorized caller → no post data.
      const access = await resolvePortalAccessForRequest()
      if (!access.granted) {
        log.debug('portal access denied, returning empty')
        return []
      }

      const { db, posts, boards, postStatuses, eq, and, isNull, desc, sql, inArray } =
        await import('@/lib/server/db')
      const { generateEmbedding } =
        await import('@/lib/server/domains/embeddings/embedding.service')
      const { postViewFilter } = await import('@/lib/server/policy')

      // Resolve the actor so the audience + moderation filter applies the
      // caller's view rules. Without this, the search returned matches
      // from team-only / segment-restricted boards and pending posts to
      // every caller — title-level leak even when the portal gate allowed
      // them through on the public-portal channel.
      const auth = await getOptionalAuth()
      const actor = await policyActorFromAuth(auth)
      const visibilityFilter = postViewFilter(actor)

      const searchQuery = data.title.trim()
      const limit = data.limit ?? 5
      const fetchLimit = limit * 2 // Fetch more for merging

      // Run hybrid search: vector + full-text IN PARALLEL
      // FTS runs immediately while embedding is generated (network call)
      const ftsPromise = db
        .select({
          id: posts.id,
          title: posts.title,
          voteCount: posts.voteCount,
          statusId: posts.statusId,
          boardId: posts.boardId,
          score:
            sql<number>`ts_rank(${posts.searchVector}, plainto_tsquery('english', ${searchQuery}))`.as(
              'score'
            ),
        })
        .from(posts)
        .innerJoin(boards, eq(posts.boardId, boards.id))
        .where(
          and(
            isNull(posts.deletedAt),
            isNull(posts.canonicalPostId),
            isNull(boards.deletedAt),
            visibilityFilter,
            sql`${posts.searchVector} @@ plainto_tsquery('english', ${searchQuery})`
          )
        )
        .orderBy(
          desc(sql`ts_rank(${posts.searchVector}, plainto_tsquery('english', ${searchQuery}))`),
          desc(posts.voteCount)
        )
        .limit(fetchLimit)

      // Vector search: embedding generation + vector query
      const vectorPromise = (async (): Promise<RawSearchResult[]> => {
        try {
          const embedding = await generateEmbedding(searchQuery)
          if (!embedding) return []

          const vectorStr = `[${embedding.join(',')}]`
          const matches = await db
            .select({
              id: posts.id,
              title: posts.title,
              voteCount: posts.voteCount,
              statusId: posts.statusId,
              boardId: posts.boardId,
              score: sql<number>`1 - (${posts.embedding} <=> ${vectorStr}::vector)`.as('score'),
            })
            .from(posts)
            .innerJoin(boards, eq(posts.boardId, boards.id))
            .where(
              and(
                isNull(posts.deletedAt),
                isNull(posts.canonicalPostId),
                isNull(boards.deletedAt),
                visibilityFilter,
                sql`${posts.embedding} IS NOT NULL`,
                sql`1 - (${posts.embedding} <=> ${vectorStr}::vector) >= 0.35`
              )
            )
            .orderBy(desc(sql`1 - (${posts.embedding} <=> ${vectorStr}::vector)`))
            .limit(fetchLimit)

          log.debug({ count: matches.length }, 'vector search results')
          return matches.map(toRawResult)
        } catch (error) {
          log.warn({ err: error }, 'vector search failed, using full-text only')
          return []
        }
      })()

      // Wait for both searches in parallel
      const [ftsMatches, vectorResults] = await Promise.all([ftsPromise, vectorPromise])

      // Normalize FTS score to 0-1 range (ts_rank typically returns 0-0.5)
      const ftsResults = ftsMatches.map((r) => ({
        ...toRawResult(r),
        score: Math.min(Number(r.score) * 2, 1),
      }))
      log.debug({ count: ftsResults.length }, 'full-text search results')

      // 3. Merge results (dedupe by ID, combine scores)
      const scoreMap = new Map<
        string,
        { result: RawSearchResult; vectorScore: number; ftsScore: number }
      >()

      for (const r of vectorResults) {
        scoreMap.set(r.id, { result: r, vectorScore: r.score, ftsScore: 0 })
      }

      for (const r of ftsResults) {
        const existing = scoreMap.get(r.id)
        if (existing) {
          existing.ftsScore = r.score
        } else {
          scoreMap.set(r.id, { result: r, vectorScore: 0, ftsScore: r.score })
        }
      }

      // Calculate hybrid score: boost when both searches match
      const merged = Array.from(scoreMap.values())
        .map(({ result, vectorScore, ftsScore }) => {
          const score = ftsScore > 0 ? Math.min(vectorScore + ftsScore * 0.3, 1) : vectorScore
          return { ...result, score }
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)

      log.debug({ count: merged.length }, 'hybrid search merged results')

      if (merged.length === 0) {
        log.debug('no matches found')
        return []
      }

      // Fetch status and board info for matched posts
      const statusIds = [
        ...new Set(merged.filter((r) => r.statusId).map((r) => r.statusId!)),
      ] as StatusId[]
      const boardIds = [...new Set(merged.map((r) => r.boardId))] as BoardId[]

      const [statusesResult, boardsResult] = await Promise.all([
        statusIds.length > 0
          ? db
              .select({ id: postStatuses.id, name: postStatuses.name, color: postStatuses.color })
              .from(postStatuses)
              .where(inArray(postStatuses.id, statusIds))
          : [],
        db
          .select({ id: boards.id, slug: boards.slug })
          .from(boards)
          .where(inArray(boards.id, boardIds)),
      ])

      const statusMap = new Map(statusesResult.map((s) => [String(s.id), s]))
      const boardMap = new Map(boardsResult.map((b) => [String(b.id), b]))

      // Build response
      const similarPosts: SimilarPost[] = merged.map((post) => {
        const status = post.statusId ? statusMap.get(post.statusId) : null
        const board = boardMap.get(post.boardId)

        return {
          id: post.id,
          title: post.title,
          voteCount: post.voteCount,
          status: status ? { name: status.name, color: status.color } : null,
          boardSlug: board?.slug ?? '',
          matchStrength: getMatchStrength(post.score),
        }
      })

      log.debug({ count: similarPosts.length }, 'find similar posts result')
      return similarPosts
    } catch (error) {
      log.error({ err: error }, 'find similar posts failed')
      return []
    }
  })
