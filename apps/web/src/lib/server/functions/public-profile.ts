/**
 * Server functions for public portal profile pages (/u/$principalId).
 *
 * Two fns, two trust levels:
 *
 *  - getPublicUserProfileFn: public. Composes (1) the portal-access gate and
 *    (2) the sanitized domain query that filters ALL activity through the
 *    caller's own board visibility. Returns null (route 404s) on any miss —
 *    the response never distinguishes "no such user" from "not visible to
 *    you".
 *
 *  - getProfileTeamContextFn: people.view-gated. Returns the team-only
 *    context strip (sanitized email, company, segments). Never called by
 *    the client unless the viewer holds the permission; enforced here
 *    regardless.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { isValidTypeId, type PrincipalId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'
import type {
  PublicProfileActivityItem,
  PublicProfileTeamContext,
} from '@/lib/server/domains/users/user.public-profile'

const log = logger.child({ component: 'public-profile' })

const profileParamsSchema = z.object({
  principalId: z.string(),
})

/** Serialized (ISO dates) activity row for the client. */
export interface PublicProfileActivityItemView {
  postId: string
  title: string
  boardSlug: string
  statusName: string | null
  statusColor: string | null
  occurredAt: string
}

/** Serialized public profile payload. */
export interface PublicUserProfileView {
  principalId: string
  displayName: string
  avatarUrl: string | null
  isTeamMember: boolean
  joinedAt: string
  postCount: number
  commentCount: number
  voteCount: number
  posts: PublicProfileActivityItemView[]
  comments: PublicProfileActivityItemView[]
  upvotes: PublicProfileActivityItemView[]
}

export type ProfileTeamContextView = PublicProfileTeamContext

function serializeItem(item: PublicProfileActivityItem): PublicProfileActivityItemView {
  return {
    postId: item.postId,
    title: item.title,
    boardSlug: item.boardSlug,
    statusName: item.statusName,
    statusColor: item.statusColor,
    occurredAt: item.occurredAt.toISOString(),
  }
}

/**
 * Public profile payload for /u/$principalId. Returns null when the profile
 * must not resolve for this caller (unknown id, anonymous/service principal,
 * portal access denied, or zero viewer-visible activity) — the route maps
 * null to notFound(), and every miss is shape-identical.
 */
export const getPublicUserProfileFn = createServerFn({ method: 'GET' })
  .validator(profileParamsSchema)
  .handler(async ({ data }): Promise<PublicUserProfileView | null> => {
    try {
      if (!isValidTypeId(data.principalId, 'principal')) return null

      // Outer gate: a private portal serves no profiles to a denied caller.
      const { resolvePortalAccessForRequest } = await import('./portal-access')
      const access = await resolvePortalAccessForRequest()
      if (!access.granted) return null

      // Resolve the CALLER's actor so all activity filtering runs from the
      // viewer's perspective (anonymous visitors get the anonymous actor).
      const [{ getOptionalAuth, policyActorFromAuth }, { getPublicUserProfile }] =
        await Promise.all([
          import('./auth-helpers'),
          import('@/lib/server/domains/users/user.public-profile'),
        ])
      const auth = await getOptionalAuth()
      const actor = await policyActorFromAuth(auth)

      const profile = await getPublicUserProfile(data.principalId as PrincipalId, actor)
      if (!profile) return null

      return {
        principalId: profile.principalId,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        isTeamMember: profile.isTeamMember,
        joinedAt: profile.joinedAt.toISOString(),
        postCount: profile.postCount,
        commentCount: profile.commentCount,
        voteCount: profile.voteCount,
        posts: profile.posts.map(serializeItem),
        comments: profile.comments.map(serializeItem),
        upvotes: profile.upvotes.map(serializeItem),
      }
    } catch (error) {
      log.error({ err: error }, 'get public user profile failed')
      throw error
    }
  })

/**
 * Team-only context strip for a profile: sanitized email, company summary,
 * segment chips, for viewers holding people.view. The client only queries
 * this when `can('people.view')`; the permission is enforced server-side
 * here regardless. Returns null when the principal isn't profile-eligible.
 */
export const getProfileTeamContextFn = createServerFn({ method: 'GET' })
  .validator(profileParamsSchema)
  .handler(async ({ data }): Promise<ProfileTeamContextView | null> => {
    const { requireAuth } = await import('./auth-helpers')
    await requireAuth({ permission: PERMISSIONS.PEOPLE_VIEW })
    try {
      if (!isValidTypeId(data.principalId, 'principal')) return null

      const { getProfileTeamContext } =
        await import('@/lib/server/domains/users/user.public-profile')
      return await getProfileTeamContext(data.principalId as PrincipalId)
    } catch (error) {
      log.error({ err: error }, 'get profile team context failed')
      throw error
    }
  })
