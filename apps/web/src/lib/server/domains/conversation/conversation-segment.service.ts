/**
 * Inbox segment read helper — drives the support inbox's left-nav "Segments"
 * group. A segment scope filters the conversation list to conversations whose
 * visitor is a member of that segment (the membership tables themselves are
 * owned by the segments domain; this only reads them for the inbox).
 *
 * Deliberately a thin conversation-side helper rather than living in the segments
 * domain, because the count it returns is conversation-specific (open conversations),
 * mirroring `listConversationTagsWithCounts` so the two nav groups read identically.
 * Authorization is enforced at the server-fn layer, not here.
 */
import {
  db,
  eq,
  and,
  isNull,
  asc,
  sql,
  segments,
  userSegments,
  conversations,
} from '@/lib/server/db'
import type { SegmentId } from '@quackback/ids'

export type InboxSegmentWithCount = {
  id: SegmentId
  name: string
  color: string
  count: number
}

/**
 * Non-deleted segments with the count of OPEN conversations whose visitor is a
 * member of each. Scoped to `status='open'` so the nav badge is an actionable
 * signal matching the default inbox view (open), exactly like
 * `listConversationTagsWithCounts`. The open filter lives in the conversations LEFT
 * JOIN's ON clause so segments with no open conversations still appear with a
 * count of 0. `count(distinct …)` guards against any membership fan-out.
 */
export async function listSegmentsWithConversationCounts(): Promise<InboxSegmentWithCount[]> {
  const rows = await db
    .select({
      id: segments.id,
      name: segments.name,
      color: segments.color,
      count: sql<number>`count(distinct ${conversations.id})::int`,
    })
    .from(segments)
    .leftJoin(userSegments, eq(userSegments.segmentId, segments.id))
    .leftJoin(
      conversations,
      and(
        eq(conversations.visitorPrincipalId, userSegments.principalId),
        eq(conversations.status, 'open')
      )
    )
    .where(isNull(segments.deletedAt))
    .groupBy(segments.id, segments.name, segments.color)
    .orderBy(asc(segments.name))
  return rows.map((r) => ({ id: r.id, name: r.name, color: r.color, count: r.count }))
}
