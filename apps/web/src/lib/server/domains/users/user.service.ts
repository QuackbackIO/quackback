/**
 * UserService - Business logic for portal user management
 *
 * Provides operations for listing and managing portal users (role='user' in principal table).
 * Portal users are authenticated users who can vote/comment on the public portal
 * but don't have admin access (unlike admin/member roles).
 *
 * All users (team + portal) are unified in the principal table with roles:
 * - admin/member: Team members with admin dashboard access
 * - user: Portal users with public portal access only
 */

import {
  db,
  eq,
  and,
  or,
  ilike,
  inArray,
  isNull,
  desc,
  asc,
  sql,
  principal,
  user,
  posts,
  comments,
  votes,
  postStatuses,
  boards,
  userSegments,
  segments,
  userAttributeDefinitions,
} from '@/lib/server/db'
import type { PrincipalId, SegmentId, UserId } from '@quackback/ids'
import { generateId } from '@quackback/ids'
import { NotFoundError, ValidationError, InternalError } from '@/lib/shared/errors'
import { coerceAttributeValue } from '@/lib/server/domains/user-attributes/coerce'
import type { UserAttributeType } from '@/lib/server/db'
import type {
  PortalUserListParams,
  PortalUserListResult,
  PortalUserListItem,
  PortalUserDetail,
  EngagedPost,
  EngagementType,
  UserSegmentSummary,
  IdentifyPortalUserInput,
  IdentifyPortalUserResult,
  UpdatePortalUserInput,
  UpdatePortalUserResult,
} from './user.types'

/**
 * Fetch segment summaries for a set of principal IDs in a single batch query.
 */
async function fetchSegmentsForPrincipals(
  principalIds: string[]
): Promise<Map<string, UserSegmentSummary[]>> {
  if (principalIds.length === 0) return new Map()

  const rows = await db
    .select({
      principalId: userSegments.principalId,
      segmentId: segments.id,
      segmentName: segments.name,
      segmentColor: segments.color,
      segmentType: segments.type,
    })
    .from(userSegments)
    .innerJoin(segments, eq(userSegments.segmentId, segments.id))
    .where(
      and(
        inArray(userSegments.principalId, principalIds as PrincipalId[]),
        isNull(segments.deletedAt)
      )
    )
    .orderBy(asc(segments.name))

  const map = new Map<string, UserSegmentSummary[]>()
  for (const row of rows) {
    if (!map.has(row.principalId)) map.set(row.principalId, [])
    map.get(row.principalId)!.push({
      id: row.segmentId as SegmentId,
      name: row.segmentName,
      color: row.segmentColor,
      type: row.segmentType as 'manual' | 'dynamic',
    })
  }
  return map
}

/**
 * List portal users for an organization with activity counts
 *
 * Queries principal table for role='user'.
 * Activity counts are computed via efficient LEFT JOINs with pre-aggregated subqueries,
 * using the indexed principal_id columns on posts, comments, and votes tables.
 *
 * Supports optional filtering by segment IDs (OR logic — users in ANY selected segment).
 */
export async function listPortalUsers(
  params: PortalUserListParams = {}
): Promise<PortalUserListResult> {
  try {
    const {
      search,
      verified,
      dateFrom,
      dateTo,
      sort = 'newest',
      page = 1,
      limit = 20,
      segmentIds,
    } = params

    // Pre-aggregate activity counts in subqueries (executed once, not per-row)
    // These use the indexed principal_id columns for efficient lookups
    // Note: We join with boards to filter by workspace
    // Each count column has a unique name to avoid ambiguity in the final SELECT
    const postCounts = db
      .select({
        principalId: posts.principalId,
        postCount: sql<number>`count(*)::int`.as('post_count'),
      })
      .from(posts)
      .where(isNull(posts.deletedAt))
      .groupBy(posts.principalId)
      .as('post_counts')

    // Comments are linked to posts, which are linked to boards
    const commentCounts = db
      .select({
        principalId: comments.principalId,
        commentCount: sql<number>`count(*)::int`.as('comment_count'),
      })
      .from(comments)
      .where(isNull(comments.deletedAt))
      .groupBy(comments.principalId)
      .as('comment_counts')

    // Votes are linked to posts, which are linked to boards
    // Use votes.principal_id (indexed) instead of string concatenation on user_identifier
    const voteCounts = db
      .select({
        principalId: votes.principalId,
        voteCount: sql<number>`count(*)::int`.as('vote_count'),
      })
      .from(votes)
      .groupBy(votes.principalId)
      .as('vote_counts')

    // Build conditions array - filter for role='user' (portal users only)
    const conditions = [eq(principal.role, 'user')]

    // Search filter (name or email)
    if (search) {
      conditions.push(or(ilike(user.name, `%${search}%`), ilike(user.email, `%${search}%`))!)
    }

    // Verified filter
    if (verified !== undefined) {
      conditions.push(eq(user.emailVerified, verified))
    }

    // Date range filters (on principal.createdAt = join date)
    if (dateFrom) {
      conditions.push(sql`${principal.createdAt} >= ${dateFrom.toISOString()}`)
    }
    if (dateTo) {
      conditions.push(sql`${principal.createdAt} <= ${dateTo.toISOString()}`)
    }

    // Segment filter — OR logic: users in ANY of the selected segments
    if (segmentIds && segmentIds.length > 0) {
      conditions.push(
        inArray(
          principal.id,
          db
            .select({ principalId: userSegments.principalId })
            .from(userSegments)
            .where(inArray(userSegments.segmentId, segmentIds as SegmentId[]))
        )
      )
    }

    const whereClause = and(...conditions)

    // Build sort order - now references the joined count columns
    let orderBy
    switch (sort) {
      case 'oldest':
        orderBy = asc(principal.createdAt)
        break
      case 'most_active':
        // Sort by total activity using the pre-joined counts
        orderBy = desc(
          sql`COALESCE(${postCounts.postCount}, 0) + COALESCE(${commentCounts.commentCount}, 0) + COALESCE(${voteCounts.voteCount}, 0)`
        )
        break
      case 'most_posts':
        orderBy = desc(sql`COALESCE(${postCounts.postCount}, 0)`)
        break
      case 'most_comments':
        orderBy = desc(sql`COALESCE(${commentCounts.commentCount}, 0)`)
        break
      case 'most_votes':
        orderBy = desc(sql`COALESCE(${voteCounts.voteCount}, 0)`)
        break
      case 'name':
        orderBy = asc(user.name)
        break
      case 'newest':
      default:
        orderBy = desc(principal.createdAt)
    }

    // Main query with LEFT JOINs to pre-aggregated counts
    const [usersResult, countResult] = await Promise.all([
      db
        .select({
          principalId: principal.id,
          userId: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          emailVerified: user.emailVerified,
          metadata: user.metadata,
          joinedAt: principal.createdAt,
          postCount: sql<number>`COALESCE(${postCounts.postCount}, 0)`,
          commentCount: sql<number>`COALESCE(${commentCounts.commentCount}, 0)`,
          voteCount: sql<number>`COALESCE(${voteCounts.voteCount}, 0)`,
        })
        .from(principal)
        .innerJoin(user, eq(principal.userId, user.id))
        .leftJoin(postCounts, eq(postCounts.principalId, principal.id))
        .leftJoin(commentCounts, eq(commentCounts.principalId, principal.id))
        .leftJoin(voteCounts, eq(voteCounts.principalId, principal.id))
        .where(whereClause)
        .orderBy(orderBy)
        .limit(limit)
        .offset((page - 1) * limit),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(principal)
        .innerJoin(user, eq(principal.userId, user.id))
        .where(whereClause),
    ])

    const total = Number(countResult[0]?.count ?? 0)

    // Batch-fetch segments for the returned users
    const segmentMap = await fetchSegmentsForPrincipals(usersResult.map((r) => r.principalId))

    const items: PortalUserListItem[] = usersResult.map((row) => ({
      principalId: row.principalId,
      userId: row.userId,
      name: row.name,
      email: row.email,
      image: row.image,
      emailVerified: row.emailVerified,
      metadata: row.metadata,
      joinedAt: row.joinedAt,
      postCount: Number(row.postCount),
      commentCount: Number(row.commentCount),
      voteCount: Number(row.voteCount),
      segments: segmentMap.get(row.principalId) ?? [],
    }))

    return {
      items,
      total,
      hasMore: page * limit < total,
    }
  } catch (error) {
    console.error('Error listing portal users:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to list portal users', error)
  }
}

/**
 * Get detailed information about a portal user including their activity
 *
 * Returns user info and all posts they've engaged with (authored, commented on, or voted on).
 */
export async function getPortalUserDetail(
  principalId: PrincipalId
): Promise<PortalUserDetail | null> {
  try {
    // Get principal with user details (filter for role='user')
    const principalResult = await db
      .select({
        principalId: principal.id,
        userId: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        emailVerified: user.emailVerified,
        metadata: user.metadata,
        joinedAt: principal.createdAt,
        createdAt: user.createdAt,
      })
      .from(principal)
      .innerJoin(user, eq(principal.userId, user.id))
      .where(and(eq(principal.id, principalId), eq(principal.role, 'user')))
      .limit(1)

    if (principalResult.length === 0) {
      return null
    }

    const principalData = principalResult[0]

    // Run independent queries in parallel for better performance
    const [authoredPosts, commentedPostIds, votedPostIds] = await Promise.all([
      // Get posts authored by this user (via principalId)
      db
        .select({
          id: posts.id,
          title: posts.title,
          content: posts.content,
          statusId: posts.statusId,
          voteCount: posts.voteCount,
          createdAt: posts.createdAt,
          authorName: sql<string | null>`(
            SELECT m.display_name FROM ${principal} m
            WHERE m.id = ${posts.principalId}
          )`.as('author_name'),
          boardSlug: boards.slug,
          boardName: boards.name,
          statusName: postStatuses.name,
          statusColor: postStatuses.color,
        })
        .from(posts)
        .innerJoin(boards, eq(posts.boardId, boards.id))
        .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
        .where(and(eq(posts.principalId, principalData.principalId), isNull(posts.deletedAt)))
        .orderBy(desc(posts.createdAt))
        .limit(100),

      // Get post IDs the user has commented on (via principalId)
      db
        .select({
          postId: comments.postId,
          latestCommentAt: sql<Date>`max(${comments.createdAt})`.as('latest_comment_at'),
        })
        .from(comments)
        .innerJoin(posts, eq(posts.id, comments.postId))
        .where(and(eq(comments.principalId, principalData.principalId), isNull(posts.deletedAt)))
        .groupBy(comments.postId)
        .limit(100),

      // Get post IDs the user has voted on (via indexed principalId column)
      db
        .select({
          postId: votes.postId,
          votedAt: votes.createdAt,
        })
        .from(votes)
        .innerJoin(posts, eq(posts.id, votes.postId))
        .where(and(eq(votes.principalId, principalData.principalId), isNull(posts.deletedAt)))
        .orderBy(desc(votes.createdAt))
        .limit(100),
    ])

    // Collect all unique post IDs that aren't authored by user (for fetching additional posts)
    const authoredIds = new Set(authoredPosts.map((p) => p.id))
    const otherPostIds = [
      ...new Set([
        ...commentedPostIds.map((c) => c.postId).filter((id) => !authoredIds.has(id)),
        ...votedPostIds.map((v) => v.postId).filter((id) => !authoredIds.has(id)),
      ]),
    ]

    // Run the dependent queries in parallel where possible
    const [otherPosts, commentCounts] = await Promise.all([
      // Fetch posts the user engaged with but didn't author
      otherPostIds.length > 0
        ? db
            .select({
              id: posts.id,
              title: posts.title,
              content: posts.content,
              statusId: posts.statusId,
              voteCount: posts.voteCount,
              createdAt: posts.createdAt,
              authorName: sql<string | null>`(
                SELECT m.display_name FROM ${principal} m
                WHERE m.id = ${posts.principalId}
              )`.as('author_name'),
              boardSlug: boards.slug,
              boardName: boards.name,
              statusName: postStatuses.name,
              statusColor: postStatuses.color,
            })
            .from(posts)
            .innerJoin(boards, eq(posts.boardId, boards.id))
            .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
            .where(and(inArray(posts.id, otherPostIds), isNull(posts.deletedAt)))
        : Promise.resolve([]),

      // Get comment counts for authored posts (we'll add otherPosts counts after)
      authoredPosts.length > 0
        ? db
            .select({
              postId: comments.postId,
              count: sql<number>`count(*)::int`.as('count'),
            })
            .from(comments)
            .where(
              and(
                inArray(
                  comments.postId,
                  authoredPosts.map((p) => p.id)
                ),
                isNull(comments.deletedAt)
              )
            )
            .groupBy(comments.postId)
        : Promise.resolve([]),
    ])

    // Get comment counts for other posts if we have any
    const otherPostCommentCounts =
      otherPosts.length > 0
        ? await db
            .select({
              postId: comments.postId,
              count: sql<number>`count(*)::int`.as('count'),
            })
            .from(comments)
            .where(
              and(
                inArray(
                  comments.postId,
                  otherPosts.map((p) => p.id)
                ),
                isNull(comments.deletedAt)
              )
            )
            .groupBy(comments.postId)
        : []

    const engagementData = {
      authoredPosts,
      commentedPostIds,
      votedPostIds,
      otherPosts,
      commentCounts: [...commentCounts, ...otherPostCommentCounts],
    }

    // Build maps for engagement tracking
    const commentedPostMap = new Map(
      engagementData.commentedPostIds.map((c) => [c.postId, c.latestCommentAt])
    )
    const votedPostMap = new Map(engagementData.votedPostIds.map((v) => [v.postId, v.votedAt]))
    const commentCountMap = new Map(
      engagementData.commentCounts.map((c) => [c.postId, Number(c.count)])
    )

    // Combine all posts into a single engaged posts list
    const allPosts = [...engagementData.authoredPosts, ...engagementData.otherPosts]
    const engagedPostsMap = new Map<string, EngagedPost>()

    for (const post of allPosts) {
      const engagementTypes: EngagementType[] = []
      const engagementDates: Date[] = []

      // Check if authored
      if (engagementData.authoredPosts.some((p) => p.id === post.id)) {
        engagementTypes.push('authored')
        engagementDates.push(post.createdAt)
      }

      // Check if commented
      const commentDate = commentedPostMap.get(post.id)
      if (commentDate) {
        engagementTypes.push('commented')
        engagementDates.push(new Date(commentDate))
      }

      // Check if voted
      const voteDate = votedPostMap.get(post.id)
      if (voteDate) {
        engagementTypes.push('voted')
        engagementDates.push(new Date(voteDate))
      }

      // Only add if there's actual engagement
      if (engagementTypes.length > 0) {
        // Truncate content for preview
        const contentPreview =
          post.content.length > 200 ? post.content.substring(0, 200) + '...' : post.content

        engagedPostsMap.set(post.id, {
          id: post.id,
          title: post.title,
          content: contentPreview,
          statusId: post.statusId,
          statusName: post.statusName,
          statusColor: post.statusColor ?? '#6b7280',
          voteCount: post.voteCount,
          commentCount: commentCountMap.get(post.id) ?? 0,
          boardSlug: post.boardSlug,
          boardName: post.boardName,
          authorName: post.authorName,
          createdAt: post.createdAt,
          engagementTypes,
          engagedAt: new Date(Math.max(...engagementDates.map((d) => d.getTime()))),
        })
      }
    }

    // Sort by most recent engagement
    const engagedPosts = Array.from(engagedPostsMap.values()).sort(
      (a, b) => b.engagedAt.getTime() - a.engagedAt.getTime()
    )

    // Calculate activity counts
    const postCount = engagementData.authoredPosts.length
    const commentCount = engagementData.commentedPostIds.length
    const voteCount = engagementData.votedPostIds.length

    // Fetch segments for this user
    const segmentMap = await fetchSegmentsForPrincipals([principalData.principalId])
    const userSegmentList = segmentMap.get(principalData.principalId) ?? []

    return {
      principalId: principalData.principalId,
      userId: principalData.userId,
      name: principalData.name,
      email: principalData.email,
      image: principalData.image,
      emailVerified: principalData.emailVerified,
      metadata: principalData.metadata,
      joinedAt: principalData.joinedAt,
      createdAt: principalData.createdAt,
      postCount,
      commentCount,
      voteCount,
      engagedPosts,
      segments: userSegmentList,
    }
  } catch (error) {
    console.error('Error getting portal user detail:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to get portal user detail', error)
  }
}

/**
 * Remove a portal user from an organization
 *
 * Deletes the principal record with role='user'.
 * Since users are org-scoped, this also deletes the user record (CASCADE).
 */
export async function removePortalUser(principalId: PrincipalId): Promise<void> {
  try {
    // Verify principal exists and has role='user'
    const existingPrincipal = await db.query.principal.findFirst({
      where: and(eq(principal.id, principalId), eq(principal.role, 'user')),
    })

    if (!existingPrincipal) {
      throw new NotFoundError(
        'MEMBER_NOT_FOUND',
        `Portal user with principal ID ${principalId} not found`
      )
    }

    // Delete principal record (user record will be deleted via CASCADE since user is org-scoped)
    await db.delete(principal).where(eq(principal.id, principalId))
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    console.error('Error removing portal user:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to remove portal user', error)
  }
}

// ============================================
// Attribute validation & parsing
// ============================================

/**
 * Safely parse user.metadata JSON string into an attributes object.
 * Returns {} on null or malformed input.
 */
export function parseUserAttributes(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {}
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>
    // Strip internal system keys (prefixed with _) from public attributes
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (!key.startsWith('_')) result[key] = value
    }
    return result
  } catch {
    return {}
  }
}

/** Internal metadata key for the customer-provided external user ID */
const EXTERNAL_ID_KEY = '_externalUserId'

/** Extract external user ID from metadata JSON string */
function extractExternalId(metadata: string | null): string | null {
  if (!metadata) return null
  try {
    const meta = JSON.parse(metadata) as Record<string, unknown>
    return typeof meta[EXTERNAL_ID_KEY] === 'string' ? meta[EXTERNAL_ID_KEY] : null
  } catch {
    return null
  }
}

/**
 * Validate and coerce incoming user attributes against configured attribute definitions.
 *
 * Attributes must be configured in Settings > User Attributes before they can be set.
 * Keys are matched by `definition.key` (not externalKey, which is for CDP integrations).
 *
 * Returns validated attributes and any errors encountered.
 */
export async function validateAndCoerceAttributes(
  attributes: Record<string, unknown>
): Promise<{
  valid: Record<string, unknown>
  removals: string[]
  errors: Array<{ key: string; reason: string }>
}> {
  const errors: Array<{ key: string; reason: string }> = []
  const valid: Record<string, unknown> = {}
  const removals: string[] = []

  const attrDefs = await db.select().from(userAttributeDefinitions)
  const defByKey = new Map(attrDefs.map((d) => [d.key, d]))

  for (const [key, value] of Object.entries(attributes)) {
    const def = defByKey.get(key)
    if (!def) {
      errors.push({ key, reason: `No attribute definition found for key '${key}'` })
      continue
    }

    // null means "unset this attribute"
    if (value === null) {
      removals.push(key)
      continue
    }

    const coerced = coerceAttributeValue(value, def.type as UserAttributeType)
    if (coerced === undefined) {
      errors.push({
        key,
        reason: `Value '${String(value)}' cannot be coerced to type '${def.type}'`,
      })
      continue
    }

    valid[key] = coerced
  }

  return { valid, removals, errors }
}

/**
 * Merge validated attributes into existing metadata, applying removals.
 * Uses full JSON parse (not parseUserAttributes) to preserve internal _-prefixed keys.
 */
function mergeMetadata(
  existing: string | null,
  valid: Record<string, unknown>,
  removals: string[]
): string {
  let current: Record<string, unknown> = {}
  if (existing) {
    try {
      current = JSON.parse(existing) as Record<string, unknown>
    } catch {
      // ignore malformed metadata
    }
  }
  const merged = { ...current, ...valid }
  for (const key of removals) {
    delete merged[key]
  }
  return JSON.stringify(merged)
}

// ============================================
// Shared helpers for identify & update
// ============================================

const USER_COLUMNS = {
  id: true,
  name: true,
  email: true,
  image: true,
  emailVerified: true,
  metadata: true,
  createdAt: true,
} as const

/**
 * Validate attributes if provided, throwing on errors.
 * Returns validated attrs and removals (empty if no attributes given).
 */
async function validateInputAttributes(
  attributes: Record<string, unknown> | undefined
): Promise<{ validAttrs: Record<string, unknown>; attrRemovals: string[] }> {
  if (!attributes || Object.keys(attributes).length === 0) {
    return { validAttrs: {}, attrRemovals: [] }
  }
  const result = await validateAndCoerceAttributes(attributes)
  if (result.errors.length > 0) {
    throw new ValidationError('VALIDATION_ERROR', 'One or more user attributes are invalid', {
      invalidAttributes: result.errors,
    })
  }
  return { validAttrs: result.valid, attrRemovals: result.removals }
}

// ============================================
// Identify (upsert) & Update
// ============================================

/**
 * Identify (create or update) a portal user by email.
 *
 * - If the user exists: update name, image, emailVerified, and merge attributes.
 * - If the user does not exist: create user + principal with role='user'.
 *
 * Attributes must be configured in Settings > User Attributes before they can be set.
 */
export async function identifyPortalUser(
  input: IdentifyPortalUserInput
): Promise<IdentifyPortalUserResult> {
  const normalizedEmail = input.email.trim().toLowerCase()
  const defaultName = input.name || normalizedEmail.split('@')[0]

  const { validAttrs, attrRemovals } = await validateInputAttributes(input.attributes)

  // Apply updates to an existing user record and sync the principal
  async function applyUpdates(record: {
    id: UserId
    name: string
    email: string
    image: string | null
    emailVerified: boolean
    metadata: string | null
    createdAt: Date
  }) {
    const userUpdates: Record<string, unknown> = {}
    if (input.name !== undefined && input.name !== record.name) userUpdates.name = input.name
    if (input.image !== undefined && input.image !== record.image) userUpdates.image = input.image
    if (input.emailVerified !== undefined && input.emailVerified !== record.emailVerified) {
      userUpdates.emailVerified = input.emailVerified
    }
    // Merge attributes and externalId into metadata
    const metadataUpdates = { ...validAttrs }
    const metadataRemovals = [...attrRemovals]
    if (input.externalId !== undefined) {
      if (input.externalId === null) {
        metadataRemovals.push(EXTERNAL_ID_KEY)
      } else {
        metadataUpdates[EXTERNAL_ID_KEY] = input.externalId
      }
    }
    if (Object.keys(metadataUpdates).length > 0 || metadataRemovals.length > 0) {
      userUpdates.metadata = mergeMetadata(record.metadata, metadataUpdates, metadataRemovals)
    }

    if (Object.keys(userUpdates).length > 0) {
      userUpdates.updatedAt = new Date()
      await db.update(user).set(userUpdates).where(eq(user.id, record.id))
    }

    // Sync principal displayName and avatarUrl if changed
    const principalUpdates: Record<string, unknown> = {}
    if (input.name !== undefined) principalUpdates.displayName = input.name
    if (input.image !== undefined) principalUpdates.avatarUrl = input.image
    if (Object.keys(principalUpdates).length > 0) {
      await db.update(principal).set(principalUpdates).where(eq(principal.userId, record.id))
    }

    // Re-read to get updated values
    return (await db.query.user.findFirst({
      where: eq(user.id, record.id),
      columns: USER_COLUMNS,
    }))!
  }

  // Try to find existing user
  let userRecord = await db.query.user.findFirst({
    where: eq(user.email, normalizedEmail),
    columns: USER_COLUMNS,
  })

  let created = false

  if (userRecord) {
    userRecord = await applyUpdates(userRecord)
  } else {
    const initialMeta: Record<string, unknown> = { ...validAttrs }
    if (input.externalId) initialMeta[EXTERNAL_ID_KEY] = input.externalId
    const metadata = Object.keys(initialMeta).length > 0 ? JSON.stringify(initialMeta) : null

    try {
      const [newUser] = await db
        .insert(user)
        .values({
          id: generateId('user'),
          name: defaultName,
          email: normalizedEmail,
          emailVerified: input.emailVerified ?? false,
          image: input.image ?? null,
          metadata,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning()
      userRecord = newUser

      await db.insert(principal).values({
        id: generateId('principal'),
        userId: newUser.id,
        role: 'user',
        displayName: defaultName,
        avatarUrl: input.image ?? null,
        createdAt: new Date(),
      })

      created = true
    } catch (err) {
      // Handle concurrent insert race condition (unique constraint on email)
      if ((err as { code?: string }).code === '23505') {
        userRecord = (await db.query.user.findFirst({
          where: eq(user.email, normalizedEmail),
          columns: USER_COLUMNS,
        }))!
        userRecord = await applyUpdates(userRecord)
      } else {
        throw err
      }
    }
  }

  const principalRecord = await db.query.principal.findFirst({
    where: eq(principal.userId, userRecord.id),
    columns: { id: true },
  })

  return {
    principalId: principalRecord!.id as PrincipalId,
    userId: userRecord.id,
    name: userRecord.name ?? defaultName,
    email: userRecord.email,
    image: userRecord.image ?? null,
    emailVerified: userRecord.emailVerified,
    externalId: extractExternalId(userRecord.metadata ?? null),
    attributes: parseUserAttributes(userRecord.metadata ?? null),
    createdAt: userRecord.createdAt,
    created,
  }
}

/**
 * Update an existing portal user's profile and attributes.
 *
 * Only updates fields that are provided in the input.
 * Attributes must be configured in Settings > User Attributes before they can be set.
 */
export async function updatePortalUser(
  principalId: PrincipalId,
  input: UpdatePortalUserInput
): Promise<UpdatePortalUserResult> {
  const principalRecord = await db
    .select({
      principalId: principal.id,
      userId: principal.userId,
    })
    .from(principal)
    .where(and(eq(principal.id, principalId), eq(principal.role, 'user')))
    .limit(1)

  if (principalRecord.length === 0 || !principalRecord[0].userId) {
    throw new NotFoundError(
      'MEMBER_NOT_FOUND',
      `Portal user with principal ID ${principalId} not found`
    )
  }

  const userId = principalRecord[0].userId

  const { validAttrs, attrRemovals } = await validateInputAttributes(input.attributes)

  const userRecord = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: USER_COLUMNS,
  })
  if (!userRecord) {
    throw new NotFoundError('MEMBER_NOT_FOUND', 'User record not found')
  }

  const userUpdates: Record<string, unknown> = {}
  if (input.name !== undefined && input.name !== userRecord.name) userUpdates.name = input.name
  if (input.image !== undefined && input.image !== userRecord.image) userUpdates.image = input.image
  if (input.emailVerified !== undefined && input.emailVerified !== userRecord.emailVerified) {
    userUpdates.emailVerified = input.emailVerified
  }
  // Merge attributes and externalId into metadata
  const metadataUpdates = { ...validAttrs }
  const metadataRemovals = [...attrRemovals]
  if (input.externalId !== undefined) {
    if (input.externalId === null) {
      metadataRemovals.push(EXTERNAL_ID_KEY)
    } else {
      metadataUpdates[EXTERNAL_ID_KEY] = input.externalId
    }
  }
  if (Object.keys(metadataUpdates).length > 0 || metadataRemovals.length > 0) {
    userUpdates.metadata = mergeMetadata(
      userRecord.metadata ?? null,
      metadataUpdates,
      metadataRemovals
    )
  }

  if (Object.keys(userUpdates).length > 0) {
    userUpdates.updatedAt = new Date()
    await db.update(user).set(userUpdates).where(eq(user.id, userId))
  }

  const principalUpdates: Record<string, unknown> = {}
  if (input.name !== undefined) principalUpdates.displayName = input.name
  if (input.image !== undefined) principalUpdates.avatarUrl = input.image
  if (Object.keys(principalUpdates).length > 0) {
    await db.update(principal).set(principalUpdates).where(eq(principal.id, principalId))
  }

  const updated = (await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: USER_COLUMNS,
  }))!

  return {
    principalId,
    userId: updated.id,
    name: updated.name ?? updated.email.split('@')[0],
    email: updated.email,
    image: updated.image ?? null,
    emailVerified: updated.emailVerified,
    externalId: extractExternalId(updated.metadata ?? null),
    attributes: parseUserAttributes(updated.metadata ?? null),
    createdAt: updated.createdAt,
  }
}
