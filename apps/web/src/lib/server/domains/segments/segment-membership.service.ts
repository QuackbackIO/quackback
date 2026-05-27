/**
 * Single write path for segment membership.
 *
 * All four ingestion sources (manual / sso / widget / api) plus the
 * dynamic-segment evaluator flow through here so audit events fire
 * consistently and reconcile logic can stay simple.
 *
 * Source-priority guard inside addMember prevents demotion: a manual
 * admin assignment will never be overwritten by a subsequent SSO claim,
 * and reconcileSsoMemberships can therefore safely delete only the
 * rows whose addedBy is still 'sso'.
 */
import { db, userSegments, eq, and, inArray, sql } from '@/lib/server/db'
import { recordAuditEvent, type AuditActor } from '@/lib/server/audit/log'
import type { PrincipalId, SegmentId } from '@quackback/ids'

export type MembershipSource = 'manual' | 'sso' | 'widget' | 'api' | 'dynamic'

/**
 * Source-precedence: higher wins on conflict. Manual admin intent is
 * the most durable assertion; SSO and dynamic are volatile.
 *
 *   manual > api > widget > sso > dynamic
 */
const SOURCE_PRIORITY: Record<MembershipSource, number> = {
  manual: 5,
  api: 4,
  widget: 3,
  sso: 2,
  dynamic: 1,
}

export interface AddMemberInput {
  principalId: PrincipalId
  segmentId: SegmentId
  source: MembershipSource
  actor: AuditActor | null
  headers?: Headers
}

/**
 * Insert or upgrade a segment membership atomically.
 *
 * The previous implementation read the row, decided priority in JS,
 * then INSERTed or UPDATEd. A concurrent lower-priority writer could
 * commit after a higher-priority writer read the old state and
 * silently demote the row — losing manual/admin access on a later
 * SSO reconcile. The fix is a single INSERT … ON CONFLICT DO UPDATE
 * with a SQL-evaluated priority predicate, so the priority check and
 * the write are one statement and cannot interleave.
 *
 * The `setWhere` predicate fires the UPDATE only when the incoming
 * source has strictly higher priority than the existing row. On equal
 * priority the existing row wins (no-op), mirroring the legacy
 * `newPriority > existingPriority` check.
 */
export async function addMember(input: AddMemberInput): Promise<void> {
  await db
    .insert(userSegments)
    .values({
      principalId: input.principalId,
      segmentId: input.segmentId,
      addedBy: input.source,
    })
    .onConflictDoUpdate({
      target: [userSegments.principalId, userSegments.segmentId],
      set: { addedBy: input.source },
      // SQL-evaluated equivalent of SOURCE_PRIORITY[input.source] >
      // SOURCE_PRIORITY[existing.addedBy]. Incoming priority is a
      // numeric literal known at call time; existing priority is
      // computed from the stored addedBy via a CASE expression.
      setWhere: sql`(
        CASE ${userSegments.addedBy}
          WHEN 'manual' THEN ${SOURCE_PRIORITY.manual}
          WHEN 'api' THEN ${SOURCE_PRIORITY.api}
          WHEN 'widget' THEN ${SOURCE_PRIORITY.widget}
          WHEN 'sso' THEN ${SOURCE_PRIORITY.sso}
          WHEN 'dynamic' THEN ${SOURCE_PRIORITY.dynamic}
          ELSE 0
        END
      ) < ${SOURCE_PRIORITY[input.source]}`,
    })

  // Audit fires whenever an actor is supplied — including the no-op
  // "preserve stickier source" path. The behaviour is intentional:
  // the actor field captures CALLER INTENT, and an admin clicking
  // "Add user to segment X" or an API key POSTing to a segment-members
  // route IS expressing intent even when the row was already there.
  // System reconciles (SSO / widget) pass null and don't audit.
  if (input.actor) {
    await recordAuditEvent({
      event: 'segment.member.added',
      actor: input.actor,
      headers: input.headers,
      target: { type: 'segment', id: input.segmentId },
      metadata: { principalId: input.principalId, source: input.source },
    })
  }
}

export interface RemoveMemberInput {
  principalId: PrincipalId
  segmentId: SegmentId
  actor: AuditActor | null
  headers?: Headers
}

export async function removeMember(input: RemoveMemberInput): Promise<void> {
  await db
    .delete(userSegments)
    .where(
      and(
        eq(userSegments.principalId, input.principalId),
        eq(userSegments.segmentId, input.segmentId)
      )
    )
  if (input.actor) {
    await recordAuditEvent({
      event: 'segment.member.removed',
      actor: input.actor,
      headers: input.headers,
      target: { type: 'segment', id: input.segmentId },
      metadata: { principalId: input.principalId },
    })
  }
}

/**
 * Reconcile SSO-sourced memberships for a principal against the IdP
 * claim.
 *
 * - Removes rows where addedBy='sso' AND the segment is no longer in
 *   the claim. The addedBy='sso' guard keeps manual/widget/api
 *   memberships safe even if the claim drops them.
 * - For each segment in the claim, calls addMember(..., 'sso'). The
 *   source-priority guard makes that a no-op when a stickier
 *   (manual/api/widget) membership already exists.
 */
export async function reconcileSsoMemberships(input: {
  principalId: PrincipalId
  desiredSegmentIds: SegmentId[]
}): Promise<void> {
  const existing = await db
    .select()
    .from(userSegments)
    .where(and(eq(userSegments.principalId, input.principalId), eq(userSegments.addedBy, 'sso')))

  const existingIds = new Set(existing.map((r) => r.segmentId))
  const desiredIds = new Set(input.desiredSegmentIds)

  const toRemove = [...existingIds].filter((id) => !desiredIds.has(id as SegmentId))
  const toAdd = [...desiredIds].filter((id) => !existingIds.has(id))

  if (toRemove.length > 0) {
    await db
      .delete(userSegments)
      .where(
        and(
          eq(userSegments.principalId, input.principalId),
          eq(userSegments.addedBy, 'sso'),
          inArray(userSegments.segmentId, toRemove as never[])
        )
      )
  }
  for (const segmentId of toAdd) {
    await addMember({
      principalId: input.principalId,
      segmentId: segmentId as SegmentId,
      source: 'sso',
      actor: null,
    })
  }
}

/**
 * Reconcile widget-sourced memberships for a principal against the
 * latest signed JWT.
 *
 * The widget identify route used to be additive-only — a customer's
 * auth server could mint `segments: ['enterprise']` once and never
 * revoke it; a canceled customer kept their portal-access grant via
 * `allowedSegmentIds` indefinitely. This helper mirrors the SSO
 * reconcile contract:
 *
 * - Removes rows where addedBy='widget' AND the segment is no longer in
 *   the JWT. The addedBy='widget' guard keeps manual / sso / api
 *   memberships safe even if the JWT drops them.
 * - For each segment in the JWT, calls addMember(..., 'widget'). The
 *   source-priority guard makes that a no-op when a stickier
 *   (manual / api / sso) membership already exists.
 */
export async function reconcileWidgetMemberships(input: {
  principalId: PrincipalId
  desiredSegmentIds: SegmentId[]
}): Promise<void> {
  const existing = await db
    .select()
    .from(userSegments)
    .where(and(eq(userSegments.principalId, input.principalId), eq(userSegments.addedBy, 'widget')))

  const existingIds = new Set(existing.map((r) => r.segmentId))
  const desiredIds = new Set(input.desiredSegmentIds)

  const toRemove = [...existingIds].filter((id) => !desiredIds.has(id as SegmentId))
  const toAdd = [...desiredIds].filter((id) => !existingIds.has(id))

  if (toRemove.length > 0) {
    await db
      .delete(userSegments)
      .where(
        and(
          eq(userSegments.principalId, input.principalId),
          eq(userSegments.addedBy, 'widget'),
          inArray(userSegments.segmentId, toRemove as never[])
        )
      )
  }
  for (const segmentId of toAdd) {
    await addMember({
      principalId: input.principalId,
      segmentId: segmentId as SegmentId,
      source: 'widget',
      actor: null,
    })
  }
}

/**
 * Resolve a principal's segment memberships for use in policy decisions.
 * Cache at the request level — do not call once per row.
 */
export async function segmentIdsForPrincipal(
  principalId: PrincipalId | null
): Promise<ReadonlySet<SegmentId>> {
  if (!principalId) return new Set()
  const rows = await db
    .select({ segmentId: userSegments.segmentId })
    .from(userSegments)
    .where(eq(userSegments.principalId, principalId))
  return new Set(rows.map((r) => r.segmentId as SegmentId))
}
