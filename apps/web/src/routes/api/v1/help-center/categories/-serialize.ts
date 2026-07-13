/**
 * Shared serializer for help-center category API responses.
 *
 * Colocated route helper (the `-` prefix keeps it out of the generated route
 * tree). Includes the audience/visibility fields so REST consumers can read and
 * round-trip targeting just like the admin UI.
 */
import type { HelpCenterCategory } from '@/lib/server/domains/help-center/help-center.types'

export function formatHelpCenterCategory(cat: HelpCenterCategory) {
  return {
    id: cat.id,
    slug: cat.slug,
    name: cat.name,
    description: cat.description,
    icon: cat.icon,
    parentId: cat.parentId,
    isPublic: cat.isPublic,
    visibility: cat.visibility,
    allowedSegmentIds: cat.allowedSegmentIds,
    allowedPrincipalIds: cat.allowedPrincipalIds,
    position: cat.position,
    createdAt: cat.createdAt.toISOString(),
    updatedAt: cat.updatedAt.toISOString(),
  }
}
