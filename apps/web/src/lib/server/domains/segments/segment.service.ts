/**
 * SegmentService - Business logic for user segmentation
 *
 * Supports manual segments (admin-assigned) and dynamic segments
 * (rule-based, evaluated and cached in user_segments).
 *
 * Dynamic evaluation translates rules into efficient SQL queries
 * rather than loading all users into memory.
 */

import { db, eq, and, inArray, isNull, sql, asc, segments, userSegments } from '@/lib/server/db'
import type { SegmentId, PrincipalId } from '@quackback/ids'
import { createId } from '@quackback/ids'
import { NotFoundError, ValidationError, ForbiddenError, InternalError } from '@/lib/shared/errors'
import type {
  Segment,
  SegmentWithCount,
  SegmentSummary,
  CreateSegmentInput,
  UpdateSegmentInput,
  EvaluationResult,
} from './segment.types'
import type {
  SegmentRules,
  SegmentCondition,
  EvaluationSchedule,
  SegmentWeightConfig,
} from '@/lib/server/db'

// ============================================
// Helpers
// ============================================

function rowToSegment(row: {
  id: string
  name: string
  description: string | null
  type: string
  color: string
  rules: unknown
  evaluationSchedule?: unknown
  weightConfig?: unknown
  createdAt: Date
  updatedAt: Date
}): Segment {
  return {
    id: row.id as SegmentId,
    name: row.name,
    description: row.description,
    type: row.type as 'manual' | 'dynamic',
    color: row.color,
    rules: (row.rules as SegmentRules) ?? null,
    evaluationSchedule: (row.evaluationSchedule as EvaluationSchedule) ?? null,
    weightConfig: (row.weightConfig as SegmentWeightConfig) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

// ============================================
// CRUD
// ============================================

/**
 * List all active segments with member counts.
 */
export async function listSegments(): Promise<SegmentWithCount[]> {
  try {
    const memberCounts = db
      .select({
        segmentId: userSegments.segmentId,
        count: sql<number>`count(*)::int`.as('member_count'),
      })
      .from(userSegments)
      .groupBy(userSegments.segmentId)
      .as('member_counts')

    const rows = await db
      .select({
        id: segments.id,
        name: segments.name,
        description: segments.description,
        type: segments.type,
        color: segments.color,
        rules: segments.rules,
        evaluationSchedule: segments.evaluationSchedule,
        weightConfig: segments.weightConfig,
        createdAt: segments.createdAt,
        updatedAt: segments.updatedAt,
        memberCount: sql<number>`COALESCE(${memberCounts.count}, 0)`,
      })
      .from(segments)
      .leftJoin(memberCounts, eq(memberCounts.segmentId, segments.id))
      .where(isNull(segments.deletedAt))
      .orderBy(asc(segments.name))

    return rows.map((row) => ({
      ...rowToSegment(row),
      memberCount: Number(row.memberCount),
    }))
  } catch (error) {
    console.error('Error listing segments:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to list segments', error)
  }
}

/**
 * Get a single segment by ID.
 */
export async function getSegment(segmentId: SegmentId): Promise<Segment | null> {
  try {
    const row = await db.query.segments.findFirst({
      where: and(eq(segments.id, segmentId), isNull(segments.deletedAt)),
    })
    if (!row) return null
    return rowToSegment(row)
  } catch (error) {
    console.error('Error getting segment:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to get segment', error)
  }
}

/**
 * Create a new segment.
 */
export async function createSegment(input: CreateSegmentInput): Promise<Segment> {
  try {
    if (!input.name?.trim()) {
      throw new ValidationError('VALIDATION_ERROR', 'Segment name is required')
    }
    if (input.type === 'dynamic' && (!input.rules || !input.rules.conditions?.length)) {
      throw new ValidationError(
        'VALIDATION_ERROR',
        'Dynamic segments require at least one rule condition'
      )
    }

    const id = createId('segment') as SegmentId

    const [row] = await db
      .insert(segments)
      .values({
        id,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        type: input.type,
        color: input.color ?? '#6b7280',
        rules: input.type === 'dynamic' ? (input.rules ?? null) : null,
        evaluationSchedule: input.type === 'dynamic' ? (input.evaluationSchedule ?? null) : null,
        weightConfig: input.weightConfig ?? null,
      })
      .returning()

    return rowToSegment(row)
  } catch (error) {
    if (error instanceof ValidationError) throw error
    console.error('Error creating segment:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to create segment', error)
  }
}

/**
 * Update an existing segment.
 */
export async function updateSegment(
  segmentId: SegmentId,
  input: UpdateSegmentInput
): Promise<Segment> {
  try {
    const existing = await getSegment(segmentId)
    if (!existing) {
      throw new NotFoundError('SEGMENT_NOT_FOUND', `Segment ${segmentId} not found`)
    }

    const updates: Partial<typeof segments.$inferInsert> = {}
    if (input.name !== undefined) updates.name = input.name.trim()
    if (input.description !== undefined) updates.description = input.description
    if (input.color !== undefined) updates.color = input.color
    if (input.rules !== undefined) updates.rules = input.rules
    if (input.evaluationSchedule !== undefined)
      updates.evaluationSchedule = input.evaluationSchedule
    if (input.weightConfig !== undefined) updates.weightConfig = input.weightConfig

    if (Object.keys(updates).length === 0) {
      return existing
    }

    const [row] = await db
      .update(segments)
      .set(updates)
      .where(eq(segments.id, segmentId))
      .returning()

    return rowToSegment(row)
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) throw error
    console.error('Error updating segment:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to update segment', error)
  }
}

/**
 * Soft-delete a segment and its membership records.
 */
export async function deleteSegment(segmentId: SegmentId): Promise<void> {
  try {
    const existing = await getSegment(segmentId)
    if (!existing) {
      throw new NotFoundError('SEGMENT_NOT_FOUND', `Segment ${segmentId} not found`)
    }

    // Remove all memberships first, then soft-delete the segment
    await db.delete(userSegments).where(eq(userSegments.segmentId, segmentId))
    await db.update(segments).set({ deletedAt: new Date() }).where(eq(segments.id, segmentId))
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    console.error('Error deleting segment:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to delete segment', error)
  }
}

// ============================================
// Manual Membership Management
// ============================================

/**
 * Assign users to a manual segment (bulk). Idempotent — existing members are skipped.
 */
export async function assignUsersToSegment(
  segmentId: SegmentId,
  principalIds: PrincipalId[]
): Promise<void> {
  try {
    const segment = await getSegment(segmentId)
    if (!segment) {
      throw new NotFoundError('SEGMENT_NOT_FOUND', `Segment ${segmentId} not found`)
    }
    if (segment.type !== 'manual') {
      throw new ForbiddenError(
        'SEGMENT_TYPE_ERROR',
        'Cannot manually assign users to a dynamic segment'
      )
    }
    if (principalIds.length === 0) return

    // Insert with conflict ignore (idempotent)
    await db
      .insert(userSegments)
      .values(
        principalIds.map((pid) => ({
          principalId: pid,
          segmentId,
          addedBy: 'manual' as const,
        }))
      )
      .onConflictDoNothing()
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) throw error
    console.error('Error assigning users to segment:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to assign users to segment', error)
  }
}

/**
 * Remove users from a manual segment (bulk).
 */
export async function removeUsersFromSegment(
  segmentId: SegmentId,
  principalIds: PrincipalId[]
): Promise<void> {
  try {
    const segment = await getSegment(segmentId)
    if (!segment) {
      throw new NotFoundError('SEGMENT_NOT_FOUND', `Segment ${segmentId} not found`)
    }
    if (segment.type !== 'manual') {
      throw new ForbiddenError(
        'SEGMENT_TYPE_ERROR',
        'Cannot manually remove users from a dynamic segment'
      )
    }
    if (principalIds.length === 0) return

    await db
      .delete(userSegments)
      .where(
        and(eq(userSegments.segmentId, segmentId), inArray(userSegments.principalId, principalIds))
      )
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) throw error
    console.error('Error removing users from segment:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to remove users from segment', error)
  }
}

// ============================================
// User → Segments Lookup
// ============================================

/**
 * Get all segments a portal user belongs to (summaries).
 */
export async function getUserSegments(principalId: PrincipalId): Promise<SegmentSummary[]> {
  try {
    const rows = await db
      .select({
        id: segments.id,
        name: segments.name,
        color: segments.color,
        type: segments.type,
      })
      .from(userSegments)
      .innerJoin(segments, eq(userSegments.segmentId, segments.id))
      .where(and(eq(userSegments.principalId, principalId), isNull(segments.deletedAt)))
      .orderBy(asc(segments.name))

    return rows.map((row) => ({
      id: row.id as SegmentId,
      name: row.name,
      color: row.color,
      type: row.type as 'manual' | 'dynamic',
    }))
  } catch (error) {
    console.error('Error getting user segments:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to get user segments', error)
  }
}

/**
 * Get the set of principal IDs that belong to any of the given segments (for filtering).
 * Returns null if segmentIds is empty (meaning: no filter applied).
 */
export async function getPrincipalIdsInSegments(
  segmentIds: SegmentId[]
): Promise<Set<string> | null> {
  if (segmentIds.length === 0) return null

  try {
    const rows = await db
      .select({ principalId: userSegments.principalId })
      .from(userSegments)
      .where(inArray(userSegments.segmentId, segmentIds))

    return new Set(rows.map((r) => r.principalId))
  } catch (error) {
    console.error('Error getting principal IDs for segments:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to filter by segments', error)
  }
}

// ============================================
// Dynamic Segment Evaluation
// ============================================

/**
 * Build a SQL condition fragment for a single rule condition.
 * Returns a SQL template or null if the condition is unsupported.
 */
function buildConditionSql(condition: SegmentCondition): ReturnType<typeof sql> | null {
  const { attribute, operator, value } = condition

  // Map operator to SQL comparator
  const opMap: Record<string, string> = {
    eq: '=',
    neq: '!=',
    lt: '<',
    lte: '<=',
    gt: '>',
    gte: '>=',
  }

  // Handle is_set / is_not_set for metadata-backed attributes
  if (operator === 'is_set' || operator === 'is_not_set') {
    const isSet = operator === 'is_set'
    switch (attribute) {
      case 'email_domain':
        return isSet ? sql`u.email IS NOT NULL` : sql`u.email IS NULL`
      case 'email_verified':
        // email_verified is boolean NOT NULL — use = true / = false, not IS NULL
        return isSet ? sql`u.email_verified = true` : sql`u.email_verified = false`
      case 'plan':
        return isSet
          ? sql`(u.metadata::jsonb->>'plan') IS NOT NULL`
          : sql`(u.metadata::jsonb->>'plan') IS NULL`
      case 'metadata_key': {
        const key = condition.metadataKey
        if (!key) return null
        return isSet
          ? sql`(u.metadata::jsonb->>${key}) IS NOT NULL`
          : sql`(u.metadata::jsonb->>${key}) IS NULL`
      }
      case 'post_count':
        return isSet
          ? sql`(SELECT COUNT(*)::int FROM posts WHERE posts.principal_id = p.id AND posts.deleted_at IS NULL) > 0`
          : sql`(SELECT COUNT(*)::int FROM posts WHERE posts.principal_id = p.id AND posts.deleted_at IS NULL) = 0`
      case 'vote_count':
        return isSet
          ? sql`(SELECT COUNT(*)::int FROM votes WHERE votes.principal_id = p.id) > 0`
          : sql`(SELECT COUNT(*)::int FROM votes WHERE votes.principal_id = p.id) = 0`
      case 'comment_count':
        return isSet
          ? sql`(SELECT COUNT(*)::int FROM comments WHERE comments.principal_id = p.id AND comments.deleted_at IS NULL) > 0`
          : sql`(SELECT COUNT(*)::int FROM comments WHERE comments.principal_id = p.id AND comments.deleted_at IS NULL) = 0`
      default:
        return null
    }
  }

  switch (attribute) {
    case 'email_verified':
      return sql`u.email_verified = ${Boolean(value)}`

    case 'email_domain': {
      const domain = String(value).replace(/^@/, '')
      if (operator === 'eq') return sql`u.email ILIKE ${'%@' + domain}`
      if (operator === 'neq') return sql`u.email NOT ILIKE ${'%@' + domain}`
      if (operator === 'ends_with') return sql`u.email ILIKE ${'%@' + domain}`
      return null
    }

    case 'created_at_days_ago': {
      // "created more than N days ago" = older than N days
      const days = Number(value)
      const sqlOp = opMap[operator]
      if (!sqlOp) return null
      return sql`(NOW() - p.created_at) ${sql.raw(sqlOp)} (${days} * INTERVAL '1 day')`
    }

    case 'plan': {
      // user.metadata is a text column storing JSON
      if (operator === 'contains')
        return sql`(u.metadata::jsonb->>'plan') ILIKE ${'%' + String(value) + '%'}`
      if (operator === 'starts_with')
        return sql`(u.metadata::jsonb->>'plan') ILIKE ${String(value) + '%'}`
      if (operator === 'ends_with')
        return sql`(u.metadata::jsonb->>'plan') ILIKE ${'%' + String(value)}`
      const sqlOp = opMap[operator]
      if (!sqlOp) return null
      return sql`(u.metadata::jsonb->>'plan') ${sql.raw(sqlOp)} ${String(value)}`
    }

    case 'metadata_key': {
      const key = condition.metadataKey
      if (!key) return null
      if (operator === 'contains')
        return sql`(u.metadata::jsonb->>${key}) ILIKE ${'%' + String(value) + '%'}`
      if (operator === 'starts_with')
        return sql`(u.metadata::jsonb->>${key}) ILIKE ${String(value) + '%'}`
      if (operator === 'ends_with')
        return sql`(u.metadata::jsonb->>${key}) ILIKE ${'%' + String(value)}`
      const sqlOp = opMap[operator]
      if (!sqlOp) return null
      // If the value is numeric, cast the JSONB text to numeric for correct comparison
      if (typeof value === 'number') {
        return sql`(u.metadata::jsonb->>${key})::numeric ${sql.raw(sqlOp)} ${value}`
      }
      return sql`(u.metadata::jsonb->>${key}) ${sql.raw(sqlOp)} ${String(value)}`
    }

    case 'post_count': {
      const n = Number(value)
      const sqlOp = opMap[operator]
      if (!sqlOp) return null
      return sql`(
        SELECT COUNT(*)::int FROM posts
        WHERE posts.principal_id = p.id
          AND posts.deleted_at IS NULL
      ) ${sql.raw(sqlOp)} ${n}`
    }

    case 'vote_count': {
      const n = Number(value)
      const sqlOp = opMap[operator]
      if (!sqlOp) return null
      return sql`(
        SELECT COUNT(*)::int FROM votes
        WHERE votes.principal_id = p.id
      ) ${sql.raw(sqlOp)} ${n}`
    }

    case 'comment_count': {
      const n = Number(value)
      const sqlOp = opMap[operator]
      if (!sqlOp) return null
      return sql`(
        SELECT COUNT(*)::int FROM comments
        WHERE comments.principal_id = p.id
          AND comments.deleted_at IS NULL
      ) ${sql.raw(sqlOp)} ${n}`
    }

    default:
      return null
  }
}

/**
 * Evaluate a dynamic segment's rules and return the set of matching principal IDs.
 * Translates rules to SQL — does not load users into memory.
 */
async function resolveMatchingPrincipals(rules: SegmentRules): Promise<string[]> {
  const conditionSqls = rules.conditions
    .map(buildConditionSql)
    .filter((c): c is NonNullable<typeof c> => c !== null)

  if (conditionSqls.length === 0) return []

  const combinedWhere =
    rules.match === 'all'
      ? conditionSqls.reduce((acc, c) => sql`${acc} AND ${c}`)
      : conditionSqls.reduce((acc, c) => sql`${acc} OR ${c}`)

  const rows = await db.execute(sql`
    SELECT p.id
    FROM principal p
    INNER JOIN "user" u ON u.id = p.user_id
    WHERE p.role = 'user'
      AND p.user_id IS NOT NULL
      AND (${combinedWhere})
  `)

  return (rows as unknown as Array<{ id: string }>).map((r) => r.id)
}

/**
 * Evaluate a single dynamic segment and sync the user_segments table.
 * Adds new matches, removes stale members.
 */
export async function evaluateDynamicSegment(segmentId: SegmentId): Promise<EvaluationResult> {
  try {
    const segment = await getSegment(segmentId)
    if (!segment) {
      throw new NotFoundError('SEGMENT_NOT_FOUND', `Segment ${segmentId} not found`)
    }
    if (segment.type !== 'dynamic') {
      throw new ValidationError('SEGMENT_TYPE_ERROR', 'Segment is not dynamic')
    }
    if (!segment.rules || !segment.rules.conditions?.length) {
      // No rules: remove all dynamic members
      const deleted = await db
        .delete(userSegments)
        .where(and(eq(userSegments.segmentId, segmentId), eq(userSegments.addedBy, 'dynamic')))
        .returning()
      return { segmentId, added: 0, removed: deleted.length }
    }

    // Get current dynamic members
    const currentMembers = await db
      .select({ principalId: userSegments.principalId })
      .from(userSegments)
      .where(and(eq(userSegments.segmentId, segmentId), eq(userSegments.addedBy, 'dynamic')))

    const currentIds = new Set(currentMembers.map((r) => r.principalId))

    // Evaluate rules → new matching set
    const matchingIds = await resolveMatchingPrincipals(segment.rules)
    const matchingSet = new Set(matchingIds)

    // Diff: to add = in matching but not current; to remove = in current but not matching
    const toAdd = matchingIds.filter((id) => !currentIds.has(id as PrincipalId)) as PrincipalId[]
    const toRemove = [...currentIds].filter(
      (id) => !matchingSet.has(id)
    ) as unknown as PrincipalId[]

    // Apply changes in a transaction
    await db.transaction(async (tx) => {
      if (toAdd.length > 0) {
        await tx
          .insert(userSegments)
          .values(
            toAdd.map((pid) => ({
              principalId: pid,
              segmentId,
              addedBy: 'dynamic' as const,
            }))
          )
          .onConflictDoNothing()
      }
      if (toRemove.length > 0) {
        await tx
          .delete(userSegments)
          .where(
            and(eq(userSegments.segmentId, segmentId), inArray(userSegments.principalId, toRemove))
          )
      }
    })

    return { segmentId, added: toAdd.length, removed: toRemove.length }
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) throw error
    console.error('Error evaluating dynamic segment:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to evaluate dynamic segment', error)
  }
}

/**
 * Evaluate all active dynamic segments.
 */
export async function evaluateAllDynamicSegments(): Promise<EvaluationResult[]> {
  try {
    const dynamicSegments = await db
      .select({ id: segments.id })
      .from(segments)
      .where(and(eq(segments.type, 'dynamic'), isNull(segments.deletedAt)))

    const results: EvaluationResult[] = []
    for (const seg of dynamicSegments) {
      const result = await evaluateDynamicSegment(seg.id as SegmentId)
      results.push(result)
    }
    return results
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) throw error
    console.error('Error evaluating all dynamic segments:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to evaluate dynamic segments', error)
  }
}

/**
 * Get all segment members (principal IDs) for a given segment.
 */
export async function getSegmentMembers(segmentId: SegmentId): Promise<PrincipalId[]> {
  try {
    const rows = await db
      .select({ principalId: userSegments.principalId })
      .from(userSegments)
      .where(eq(userSegments.segmentId, segmentId))

    return rows.map((r) => r.principalId as PrincipalId)
  } catch (error) {
    console.error('Error getting segment members:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to get segment members', error)
  }
}
