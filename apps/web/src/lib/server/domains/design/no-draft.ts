/**
 * A design row without a draft: after a discard, or once the draft is put back
 * to what visitors see, so nothing says a draft is waiting.
 */
import type { PortalDesignId, PortalDesignRevisionId } from '@quackback/ids'
import { eq, portalDesigns, type Transaction } from '@/lib/server/db'
import { draftRevision } from './draft-revision'

/** A row with no draft, and so no one's changes. */
export const NO_DRAFT = {
  draft: null,
  draftBaseRevisionId: null,
  draftUpdatedAt: null,
  draftAuthors: null,
}

/**
 * Drops the draft of a row whose draft matches what visitors see, moving its
 * revision on so a save made against the old draft is refused. Returns the
 * revision the next save names.
 */
export async function dropDraft(
  tx: Transaction,
  row: {
    id: PortalDesignId
    draft: unknown
    draftVersion: number
    publishedRevisionId: PortalDesignRevisionId | null
  }
): Promise<string> {
  if (row.draft)
    await tx
      .update(portalDesigns)
      .set({ ...NO_DRAFT, draftVersion: row.draftVersion + 1, updatedAt: new Date() })
      .where(eq(portalDesigns.id, row.id))
  return draftRevision({ ...row, draft: null })
}
