/**
 * Shared serializer for segment API responses (colocated route helper; the `-`
 * prefix keeps it out of the generated route tree).
 */
import type { Segment, SegmentWithCount } from '@/lib/server/domains/segments/segment.types'

export function serializeSegment(s: Segment | SegmentWithCount) {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    description: s.description,
    type: s.type,
    color: s.color,
    rules: s.rules,
    evaluationSchedule: s.evaluationSchedule,
    weightConfig: s.weightConfig,
    ...('memberCount' in s ? { memberCount: s.memberCount } : {}),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  }
}
