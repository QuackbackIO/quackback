import { isNull, sql, type SQL } from 'drizzle-orm'
import { roadmaps } from '@/lib/server/db'
import { allowDecision, denyDecision, isTeamActor, type Actor, type Decision } from './types'

export interface RoadmapVisibilityResource {
  visibility: 'public' | 'team' | 'segment'
  visibleSegmentIds: readonly string[] | null
  deletedAt?: Date | string | null
}

export function canViewRoadmap(actor: Actor, roadmap: RoadmapVisibilityResource): Decision {
  if (roadmap.deletedAt) return denyDecision('Roadmap not found')
  if (isTeamActor(actor)) return allowDecision()
  if (roadmap.visibility === 'public') return allowDecision()
  if (
    roadmap.visibility === 'segment' &&
    actor.principalType === 'user' &&
    (roadmap.visibleSegmentIds ?? []).some((id) => actor.segmentIds.has(id as never))
  ) {
    return allowDecision()
  }
  return denyDecision(
    roadmap.visibility === 'team' ? 'This roadmap is internal' : 'Roadmap not found'
  )
}

export function roadmapViewFilter(actor: Actor): SQL {
  if (isTeamActor(actor)) return sql`${isNull(roadmaps.deletedAt)}`

  const memberIds = Array.from(actor.segmentIds) as string[]
  const segmentMatch =
    actor.principalType === 'user' && memberIds.length > 0
      ? sql`
        ${roadmaps.visibility} = 'segment'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(COALESCE(${roadmaps.visibleSegmentIds}, '[]'::jsonb)) segment_id
          WHERE segment_id = ANY(ARRAY[${sql.join(
            memberIds.map((id) => sql`${id}`),
            sql`, `
          )}]::text[])
        )
      `
      : sql`false`

  return sql`
    ${isNull(roadmaps.deletedAt)}
    AND (
      ${roadmaps.visibility} = 'public'
      OR (${segmentMatch})
    )
  `
}
