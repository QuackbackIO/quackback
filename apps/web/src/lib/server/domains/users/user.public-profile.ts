/**
 * Public portal profile query — the sanitized sibling of getPortalUserDetail.
 *
 * Everything here is viewable by ANY portal visitor the portal-access gate
 * admits, so the payload carries no email, no company, no segments, no
 * lastSeenAt. Activity (posts authored / commented / upvoted) is filtered
 * through the VIEWER's board visibility via `postViewFilter(actor)` — a
 * profile never leaks that its owner was active on a board the viewer
 * cannot see, and a principal with zero viewer-visible contributions
 * resolves to null (anti-enumeration: the route 404s).
 *
 * The team-only context strip (email / company / segments) is a separate
 * query, `getProfileTeamContext`, whose server fn is people.view-gated.
 */

import {
  db,
  eq,
  and,
  inArray,
  isNull,
  desc,
  sql,
  principal,
  user,
  posts,
  postComments,
  postVotes,
  postStatuses,
  boards,
  userSegments,
  segments,
  companies,
  asc,
} from '@/lib/server/db'
import type { PrincipalId, SegmentId } from '@quackback/ids'
import { InternalError } from '@/lib/shared/errors'
import { realEmail } from '@/lib/shared/anonymous-email'
import { getPublicUrlOrNull } from '@/lib/server/storage/s3'
import { postViewFilter, type Actor } from '@/lib/server/policy'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'user-public-profile' })

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One activity row: a post the profile owner authored / commented on / upvoted. */
export interface PublicProfileActivityItem {
  postId: string
  title: string
  boardSlug: string
  statusName: string | null
  statusColor: string | null
  /** When the engagement happened (post created / latest comment / vote). */
  occurredAt: Date
}

/** The public, viewer-safe profile payload. NO email / company / segments. */
export interface PublicUserProfile {
  principalId: PrincipalId
  displayName: string
  avatarUrl: string | null
  /** Role-derived (admin | member). The role itself is not exposed. */
  isTeamMember: boolean
  joinedAt: Date
  /** Counts of VIEWER-VISIBLE activity only. */
  postCount: number
  commentCount: number
  voteCount: number
  posts: PublicProfileActivityItem[]
  comments: PublicProfileActivityItem[]
  upvotes: PublicProfileActivityItem[]
}

/** Team-only context strip payload (people.view-gated at the fn layer). */
export interface PublicProfileTeamContext {
  /** realEmail-sanitized — the synthetic anon placeholder never surfaces. */
  email: string | null
  company: { id: string; name: string; plan: string | null; mrrCents: number | null } | null
  segments: { id: SegmentId; name: string; color: string }[]
}

const ACTIVITY_LIMIT = 100

/** Roles a public profile may resolve for. Anything else (or a non-'user'
 *  principal type) is treated as not-found. */
const PROFILE_ROLES = ['user', 'member', 'admin'] as const

// ---------------------------------------------------------------------------
// Public profile
// ---------------------------------------------------------------------------

/**
 * Resolve the public profile of a principal as seen by `actor`.
 *
 * Returns null (callers 404) when:
 *  - the principal doesn't exist, isn't a human user (type !== 'user'),
 *    or carries a non-portal role;
 *  - the principal has zero contributions on boards visible to the viewer
 *    (anti-enumeration — the existence of the account is not revealed).
 */
export async function getPublicUserProfile(
  principalId: PrincipalId,
  actor: Actor
): Promise<PublicUserProfile | null> {
  try {
    // Human users only — the INNER join to `user` structurally excludes
    // service principals (userId is null) and the type/role predicates
    // exclude anonymous principals and any future non-portal role.
    const principalRows = await db
      .select({
        principalId: principal.id,
        displayName: principal.displayName,
        principalAvatarUrl: principal.avatarUrl,
        role: principal.role,
        joinedAt: principal.createdAt,
        userName: user.name,
        userImage: user.image,
        userImageKey: user.imageKey,
      })
      .from(principal)
      .innerJoin(user, eq(principal.userId, user.id))
      .where(
        and(
          eq(principal.id, principalId),
          eq(principal.type, 'user'),
          inArray(principal.role, [...PROFILE_ROLES])
        )
      )
      .limit(1)

    const owner = principalRows[0]
    if (!owner) return null

    // Every activity query composes postViewFilter(actor): board audience
    // (anonymous/authenticated/segments/team) + moderation state, from the
    // VIEWER's perspective. Requires the boards join (boardViewFilter reads
    // boards.access) — postViewFilter's own contract.
    const viewerFilter = postViewFilter(actor)

    const activityColumns = {
      postId: posts.id,
      title: posts.title,
      boardSlug: boards.slug,
      statusName: postStatuses.name,
      statusColor: postStatuses.color,
    }

    const [authored, commented, upvoted, [authoredCount], [commentedCount], [upvotedCount]] =
      await Promise.all([
        // Posts authored by the profile owner, visible to the viewer.
        db
          .select({ ...activityColumns, occurredAt: posts.createdAt })
          .from(posts)
          .innerJoin(boards, eq(posts.boardId, boards.id))
          .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
          .where(and(eq(posts.principalId, principalId), isNull(posts.deletedAt), viewerFilter))
          .orderBy(desc(posts.createdAt))
          .limit(ACTIVITY_LIMIT),

        // Posts the owner commented on (public comments only — a private
        // team note must never surface as public activity), grouped per
        // post with the latest comment time.
        db
          .select({
            ...activityColumns,
            occurredAt: sql<Date>`max(${postComments.createdAt})`.as('occurred_at'),
          })
          .from(postComments)
          .innerJoin(posts, eq(posts.id, postComments.postId))
          .innerJoin(boards, eq(posts.boardId, boards.id))
          .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
          .where(
            and(
              eq(postComments.principalId, principalId),
              eq(postComments.isPrivate, false),
              isNull(postComments.deletedAt),
              isNull(posts.deletedAt),
              viewerFilter
            )
          )
          .groupBy(posts.id, posts.title, boards.slug, postStatuses.name, postStatuses.color)
          .orderBy(desc(sql`max(${postComments.createdAt})`))
          .limit(ACTIVITY_LIMIT),

        // Posts the owner upvoted, visible to the viewer.
        db
          .select({ ...activityColumns, occurredAt: postVotes.createdAt })
          .from(postVotes)
          .innerJoin(posts, eq(posts.id, postVotes.postId))
          .innerJoin(boards, eq(posts.boardId, boards.id))
          .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
          .where(and(eq(postVotes.principalId, principalId), isNull(posts.deletedAt), viewerFilter))
          .orderBy(desc(postVotes.createdAt))
          .limit(ACTIVITY_LIMIT),

        // Exact viewer-visible counts (the lists above are capped).
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(posts)
          .innerJoin(boards, eq(posts.boardId, boards.id))
          .where(and(eq(posts.principalId, principalId), isNull(posts.deletedAt), viewerFilter)),
        db
          .select({ count: sql<number>`count(distinct ${postComments.postId})::int` })
          .from(postComments)
          .innerJoin(posts, eq(posts.id, postComments.postId))
          .innerJoin(boards, eq(posts.boardId, boards.id))
          .where(
            and(
              eq(postComments.principalId, principalId),
              eq(postComments.isPrivate, false),
              isNull(postComments.deletedAt),
              isNull(posts.deletedAt),
              viewerFilter
            )
          ),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(postVotes)
          .innerJoin(posts, eq(posts.id, postVotes.postId))
          .innerJoin(boards, eq(posts.boardId, boards.id))
          .where(
            and(eq(postVotes.principalId, principalId), isNull(posts.deletedAt), viewerFilter)
          ),
      ])

    const postCount = Number(authoredCount?.count ?? 0)
    const commentCount = Number(commentedCount?.count ?? 0)
    const voteCount = Number(upvotedCount?.count ?? 0)

    // Anti-enumeration: no viewer-visible contribution → the profile does
    // not exist for this viewer.
    if (postCount + commentCount + voteCount === 0) return null

    return {
      principalId: owner.principalId,
      displayName: owner.displayName ?? owner.userName ?? '',
      // Canonical avatar precedence (matches loadAuthors): user.image →
      // uploaded key's public URL → principal's synced copy.
      avatarUrl:
        owner.userImage ?? getPublicUrlOrNull(owner.userImageKey) ?? owner.principalAvatarUrl,
      isTeamMember: owner.role === 'admin' || owner.role === 'member',
      joinedAt: owner.joinedAt,
      postCount,
      commentCount,
      voteCount,
      posts: authored.map(normalizeItem),
      comments: commented.map(normalizeItem),
      upvotes: upvoted.map(normalizeItem),
    }
  } catch (error) {
    log.error({ err: error }, 'failed to get public user profile')
    throw new InternalError('DATABASE_ERROR', 'Failed to get public user profile', error)
  }
}

function normalizeItem(row: {
  postId: string
  title: string
  boardSlug: string
  statusName: string | null
  statusColor: string | null
  occurredAt: Date | string
}): PublicProfileActivityItem {
  return {
    postId: row.postId,
    title: row.title,
    boardSlug: row.boardSlug,
    statusName: row.statusName,
    statusColor: row.statusColor,
    occurredAt: new Date(row.occurredAt),
  }
}

// ---------------------------------------------------------------------------
// Team context strip (fn layer gates on people.view)
// ---------------------------------------------------------------------------

/**
 * The team-only context for a profile: sanitized email, company summary,
 * segment chips. Same principal eligibility rules as the public profile,
 * but NO activity-visibility requirement — a team viewer with people.view
 * already sees this person in the admin directory.
 */
export async function getProfileTeamContext(
  principalId: PrincipalId
): Promise<PublicProfileTeamContext | null> {
  try {
    const rows = await db
      .select({
        principalId: principal.id,
        email: user.email,
        contactEmail: principal.contactEmail,
        companyId: companies.id,
        companyName: companies.name,
        companyPlan: companies.plan,
        companyMrrCents: companies.mrrCents,
      })
      .from(principal)
      .innerJoin(user, eq(principal.userId, user.id))
      .leftJoin(companies, eq(principal.companyId, companies.id))
      .where(
        and(
          eq(principal.id, principalId),
          eq(principal.type, 'user'),
          inArray(principal.role, [...PROFILE_ROLES])
        )
      )
      .limit(1)

    const row = rows[0]
    if (!row) return null

    const segmentRows = await db
      .select({ id: segments.id, name: segments.name, color: segments.color })
      .from(userSegments)
      .innerJoin(segments, eq(userSegments.segmentId, segments.id))
      .where(and(eq(userSegments.principalId, principalId), isNull(segments.deletedAt)))
      .orderBy(asc(segments.name))

    return {
      // Synthetic anon placeholder must never surface.
      email: realEmail(row.email) ?? realEmail(row.contactEmail),
      company: row.companyId
        ? {
            id: row.companyId,
            name: row.companyName ?? '',
            plan: row.companyPlan,
            mrrCents: row.companyMrrCents,
          }
        : null,
      segments: segmentRows.map((s) => ({ id: s.id, name: s.name, color: s.color })),
    }
  } catch (error) {
    log.error({ err: error }, 'failed to get profile team context')
    throw new InternalError('DATABASE_ERROR', 'Failed to get profile team context', error)
  }
}
