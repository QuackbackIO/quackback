/**
 * SegmentService - Business logic for user segmentation
 *
 * Supports manual segments (admin-assigned) and dynamic segments
 * (rule-based, evaluated and cached in user_segments).
 *
 * Dynamic evaluation translates rules into efficient SQL queries
 * rather than loading all users into memory.
 */

import {
  db,
  eq,
  and,
  inArray,
  isNull,
  sql,
  asc,
  segments,
  userSegments,
  principal as principalTable,
} from '@/lib/server/db'
import type { SegmentId, PrincipalId } from '@quackback/ids'
import { createId } from '@quackback/ids'
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/shared/errors'
import { recordAuditEvent, type AuditActor } from '@/lib/server/audit/log'
import { slugify } from '@/lib/shared/utils/string'
import type {
  Segment,
  SegmentWithCount,
  SegmentSummary,
  CreateSegmentInput,
  UpdateSegmentInput,
} from './segment.types'
import type { EvaluationSchedule, SegmentRules, SegmentWeightConfig } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'segments' })

/**
 * Best-effort webhook dispatch for segment lifecycle events. Lazy import +
 * `service` actor + try/catch so a dispatch failure never aborts the mutation.
 * Mirrors the config-plane fire helpers.
 */
async function fireSegmentEvent(
  kind: 'created' | 'updated' | 'deleted',
  segment: Segment,
  changedFields?: string[]
): Promise<void> {
  try {
    const { dispatchSegmentCreated, dispatchSegmentUpdated, dispatchSegmentDeleted } =
      await import('@/lib/server/events/dispatch')
    const actor = { type: 'service' as const, displayName: 'segment-system' }
    const ref = {
      id: segment.id,
      slug: segment.slug,
      name: segment.name,
      type: segment.type,
      color: segment.color ?? null,
      createdAt: segment.createdAt ? segment.createdAt.toISOString() : null,
      updatedAt: segment.updatedAt ? segment.updatedAt.toISOString() : null,
    }
    if (kind === 'created') await dispatchSegmentCreated(actor, ref)
    else if (kind === 'updated') await dispatchSegmentUpdated(actor, ref, changedFields ?? [])
    else await dispatchSegmentDeleted(actor, ref)
  } catch (err) {
    log.error({ err }, `failed to dispatch segment.${kind} event`)
  }
}

// ============================================
// Helpers
// ============================================

function rowToSegment(row: {
  id: string
  name: string
  slug: string
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
    slug: row.slug,
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

/**
 * Build a unique segment slug from a display name. Probes the DB for
 * collisions and appends a numeric suffix until a free slug is found.
 *
 * `excludeId` lets `updateSegment` regenerate a slug without colliding
 * with the segment it's currently renaming (the row's own slug would
 * otherwise count as a collision and force a `-2` suffix).
 */
async function uniqueSegmentSlug(name: string, excludeId?: SegmentId): Promise<string> {
  const base = slugify(name) || 'segment'
  let candidate = base
  let counter = 2
  while (true) {
    const collision = await db.query.segments.findFirst({
      where: and(eq(segments.slug, candidate), isNull(segments.deletedAt)),
      columns: { id: true },
    })
    if (!collision || (excludeId && collision.id === excludeId)) return candidate
    candidate = `${base}-${counter}`
    counter++
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
      slug: segments.slug,
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
  const slug = await uniqueSegmentSlug(input.name.trim())

  const [row] = await db
    .insert(segments)
    .values({
      id,
      name: input.name.trim(),
      slug,
      description: input.description?.trim() || null,
      type: input.type,
      color: input.color ?? '#6b7280',
      rules: input.type === 'dynamic' ? (input.rules ?? null) : null,
      evaluationSchedule: input.type === 'dynamic' ? (input.evaluationSchedule ?? null) : null,
      weightConfig: input.weightConfig ?? null,
    })
    .returning()

  const segment = rowToSegment(row)
  void fireSegmentEvent('created', segment)
  return segment
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
  if (input.name !== undefined) {
    const trimmed = input.name.trim()
    updates.name = trimmed
    // Regenerate the slug whenever the display name moves. Widget JWTs and
    // REST callers address segments by slug, so leaving the slug pinned to
    // the original name silently breaks every tooltip / integration that
    // derived its slug from the current display name. uniqueSegmentSlug
    // excludes the row being renamed so a no-op rename ("X" → "X") doesn't
    // force a `-2` suffix.
    const nextSlug = await uniqueSegmentSlug(trimmed, segmentId)
    if (nextSlug !== existing.slug) {
      updates.slug = nextSlug
    }
  }
  if (input.description !== undefined) updates.description = input.description
  if (input.color !== undefined) updates.color = input.color
  if (input.rules !== undefined) updates.rules = input.rules
  if (input.evaluationSchedule !== undefined) updates.evaluationSchedule = input.evaluationSchedule
  if (input.weightConfig !== undefined) updates.weightConfig = input.weightConfig

  if (Object.keys(updates).length === 0) {
    return existing
  }

  const [row] = await db.update(segments).set(updates).where(eq(segments.id, segmentId)).returning()

  const segment = rowToSegment(row)
  // `slug` is a derived side-effect of renaming; report the caller-facing
  // input fields instead so receivers see the intent, not the implementation.
  const changedFields = Object.keys(updates).filter((k) => k !== 'slug')
  void fireSegmentEvent('updated', segment, changedFields)
  return segment
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
    .catch((err) => log.error({ err }, 'failed to remove segment evaluation schedule'))

  await db.transaction(async (tx) => {
    await tx.delete(userSegments).where(eq(userSegments.segmentId, segmentId))
    await tx.update(segments).set({ deletedAt: new Date() }).where(eq(segments.id, segmentId))
  })

  void fireSegmentEvent('deleted', existing)
}

// ============================================
// Manual Membership Management
// ============================================

/**
 * Assign users to a manual segment (bulk). Idempotent under the source-
 * priority guard: existing rows with a stickier source (manual=manual) stay
 * untouched, but a row currently held by sso/widget/dynamic is *promoted*
 * to manual so a later SSO-claim drop can't silently revoke the admin's
 * assignment.
 *
 * Routes through `addMember` so audit, priority, and source provenance
 * stay consistent with the four ingestion paths. The previous
 * `onConflictDoNothing` insert left sso-sourced rows reachable by
 * `reconcileSsoMemberships` deletion — see segment-membership.service.ts.
 */
export async function assignUsersToSegment(
  segmentId: SegmentId,
  principalIds: PrincipalId[],
  actor: AuditActor | null = null,
  headers?: Headers
): Promise<{ assigned: number }> {
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
  if (principalIds.length === 0) return { assigned: 0 }

  // Validate principal ids up-front so one missing id doesn't FK-violate
  // mid-loop and abort the bulk. The REST endpoint has this; the admin
  // UI path used to throw on the first bad id (UX surprise where ~half
  // the click "succeeded" but the rest silently didn't).
  const validatedRows = await db
    .select({ id: principalTable.id })
    .from(principalTable)
    .where(inArray(principalTable.id, principalIds))
  const validIds = new Set(validatedRows.map((r) => String(r.id)))
  const known = principalIds.filter((id) => validIds.has(id))
  if (known.length === 0) return { assigned: 0 }

  const { addMember } = await import('./segment-membership.service')
  for (const principalId of known) {
    await addMember({
      principalId,
      segmentId,
      source: 'manual',
      // Pass the caller's actor so admin-triggered bulk adds emit
      // segment.member.added audit rows. System / unauthenticated
      // callers pass null and the audit no-ops by design.
      actor,
      headers,
    })
  }
  return { assigned: known.length }
}

/**
 * Remove users from a manual segment (bulk).
 */
export async function removeUsersFromSegment(
  segmentId: SegmentId,
  principalIds: PrincipalId[],
  actor: AuditActor | null = null,
  headers?: Headers
): Promise<{ removed: number }> {
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
  if (principalIds.length === 0) return { removed: 0 }

  // The previous implementation skipped removeMember for the bulk path
  // and went straight to a single DELETE — which meant every admin
  // bulk-remove was invisible in the audit log, while the sibling
  // assignUsersToSegment path correctly emits one audit row per add.
  // Returning() lets us tell the audit row exactly which principals
  // were actually removed (the inArray may not match every id).
  const removedRows = await db
    .delete(userSegments)
    .where(
      and(eq(userSegments.segmentId, segmentId), inArray(userSegments.principalId, principalIds))
    )
    .returning({ principalId: userSegments.principalId })

  if (actor && removedRows.length > 0) {
    for (const row of removedRows) {
      await recordAuditEvent({
        event: 'segment.member.removed',
        actor,
        headers,
        target: { type: 'segment', id: segmentId },
        metadata: { principalId: row.principalId, source: 'manual-bulk' },
      })
    }
  }
  return { removed: removedRows.length }
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
