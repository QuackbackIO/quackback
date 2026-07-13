import type { PrincipalId, SegmentId } from '@quackback/ids'

export interface HelpCenterVisibilityActor {
  principalId: PrincipalId
  segmentIds: ReadonlySet<SegmentId>
}

export interface HelpCenterCategoryAudience {
  isPublic: boolean
  visibility: 'public' | 'targeted'
  allowedPrincipalIds: string[] | null | undefined
  allowedSegmentIds: string[] | null | undefined
}

export function canActorViewCategory(
  category: HelpCenterCategoryAudience,
  actor: HelpCenterVisibilityActor | null
): boolean {
  if (!category.isPublic) return false
  if (category.visibility === 'public') return true
  if (!actor) return false

  const principalAllowed = (category.allowedPrincipalIds ?? []).includes(actor.principalId)
  if (principalAllowed) return true

  const wantedSegments = category.allowedSegmentIds ?? []
  if (wantedSegments.length === 0) return false
  return wantedSegments.some((id) => actor.segmentIds.has(id as SegmentId))
}
