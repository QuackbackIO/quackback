/**
 * The revision a portal design's draft is at, which a save names so it never
 * overwrites a draft that changed after it was read.
 */
import type { PortalDesignRevisionId } from '@quackback/ids'
import { digestOf } from '@/lib/server/utils/canonical-json'

/**
 * What the draft being edited is known by: the revision it sits on and the
 * count of draft saves, which every save moves on. Every save, publish and
 * discard changes it, so a save that started from another is refused rather
 * than overwriting someone else's changes.
 */
export function draftRevision(row: {
  publishedRevisionId: PortalDesignRevisionId | null
  draft: unknown
  draftVersion: number
}): string {
  return digestOf({
    published: row.publishedRevisionId,
    version: row.draft ? row.draftVersion : null,
  }).slice(0, 32)
}

/** The revision of a workspace that has no design yet. */
export const EMPTY_REVISION = draftRevision({
  publishedRevisionId: null,
  draft: null,
  draftVersion: 0,
})
