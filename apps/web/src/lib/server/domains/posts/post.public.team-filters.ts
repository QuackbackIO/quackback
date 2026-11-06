import type { PrincipalId, SegmentId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy'
import { can } from '@/lib/server/policy/authorize'
import { PERMISSIONS } from '@/lib/shared/permissions'

/**
 * The team-only feed filters (owner, segments) a request may apply: only for
 * holders of post.view_private, dropped for everyone else so a crafted request
 * can never widen the public feed. `owner: 'unassigned'` matches no owner.
 */
export function teamOnlyFeedFilters(
  actor: Actor,
  data: { owner?: string; segmentIds?: string[] }
): { ownerId?: PrincipalId | null; segmentIds?: SegmentId[] } {
  if (!can(actor, PERMISSIONS.POST_VIEW_PRIVATE)) return {}
  return {
    ownerId: data.owner === 'unassigned' ? null : (data.owner as PrincipalId | undefined),
    segmentIds: data.segmentIds?.length ? (data.segmentIds as SegmentId[]) : undefined,
  }
}
