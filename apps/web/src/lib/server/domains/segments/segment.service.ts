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
import type { SegmentId, PrincipalId } from '@featurepool/ids'
import { createId } from '@featurepool/ids'
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/shared/errors'
import type {
  Segment,
  SegmentWithCount,
  SegmentSummary,
  CreateSegmentInput,
  UpdateSegmentInput,
} from './segment.types'
import type { EvaluationSchedule, SegmentRules, SegmentWeightConfig } from '@/lib/server/db'

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
}

/**
 * Get a single segment by ID.
 */
export async function getSegment(segmentId: SegmentId): Promise<Segment | null> {
  const row = await db.query.segments.findFirst({
    where: and(eq(segments.id, segmentId), isNull(segments.deletedAt)),
  })
  if (!row) return null
  return rowToSegment(row)
}

/**
 * Create a new segment.
 */
export async function createSegment(input: CreateSegmentInput): Promise<Segment> {
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
}

/**
 * Update an existing segment.
 */
export async function updateSegment(
  segmentId: SegmentId,
  input: UpdateSegmentInput
): Promise<Segment> {
  const existing = await getSegment(segmentId)
  if (!existing) {
    throw new NotFoundError('SEGMENT_NOT_FOUND', `Segment ${segmentId} not found`)
  }

  const updates: Partial<typeof segments.$inferInsert> = {}
  if (input.name !== undefined) updates.name = input.name.trim()
  if (input.description !== undefined) updates.description = input.description
  if (input.color !== undefined) updates.color = input.color
  if (input.rules !== undefined) updates.rules = input.rules
  if (input.evaluationSchedule !== undefined) updates.evaluationSchedule = input.evaluationSchedule
  if (input.weightConfig !== undefined) updates.weightConfig = input.weightConfig

  if (Object.keys(updates).length === 0) {
    return existing
  }

  const [row] = await db.update(segments).set(updates).where(eq(segments.id, segmentId)).returning()

  return rowToSegment(row)
}

/**
 * Soft-delete a segment and its membership records.
 *
 * Also removes any BullMQ evaluation schedule for the segment.
 */
export async function deleteSegment(segmentId: SegmentId): Promise<void> {
  const existing = await getSegment(segmentId)
  if (!existing) {
    throw new NotFoundError('SEGMENT_NOT_FOUND', `Segment ${segmentId} not found`)
  }

  // Clean up BullMQ evaluation schedule before deleting
  await import('@/lib/server/events/segment-scheduler')
    .then(({ removeSegmentEvaluationSchedule }) => removeSegmentEvaluationSchedule(segmentId))
    .catch((err) => console.error('[Segments] Failed to remove evaluation schedule:', err))

  await db.transaction(async (tx) => {
    await tx.delete(userSegments).where(eq(userSegments.segmentId, segmentId))
    await tx.update(segments).set({ deletedAt: new Date() }).where(eq(segments.id, segmentId))
  })
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
}

/**
 * Remove users from a manual segment (bulk).
 */
export async function removeUsersFromSegment(
  segmentId: SegmentId,
  principalIds: PrincipalId[]
): Promise<void> {
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
}

// ============================================
// User → Segments Lookup
// ============================================

/**
 * Get all segments a portal user belongs to (summaries).
 */
export async function getUserSegments(principalId: PrincipalId): Promise<SegmentSummary[]> {
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
}

/**
 * Get the set of principal IDs that belong to any of the given segments (for filtering).
 * Returns null if segmentIds is empty (meaning: no filter applied).
 */
export async function getPrincipalIdsInSegments(
  segmentIds: SegmentId[]
): Promise<Set<string> | null> {
  if (segmentIds.length === 0) return null

  const rows = await db
    .select({ principalId: userSegments.principalId })
    .from(userSegments)
    .where(inArray(userSegments.segmentId, segmentIds))

  return new Set(rows.map((r) => r.principalId))
}
