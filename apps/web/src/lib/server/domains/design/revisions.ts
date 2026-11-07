import type { PortalDesignRevisionId } from '@quackback/ids'
import { db } from '@/lib/server/db'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { designRow, revision, storedDesign } from './design.service'

/** One published version of this site's design, as this build reads it, or null. */
export async function readRevision(
  id: PortalDesignRevisionId
): Promise<{ document: PortalDesign; number: number } | null> {
  const [row, old] = await Promise.all([designRow(db), revision(db, id)])
  if (!row || !old || old.designId !== row.id) return null
  const document = storedDesign(old.document, `revision ${old.number}`)
  return document ? { document, number: old.number } : null
}

/** Whether a draft is waiting to be published, read without the design itself. */
export async function draftWaiting(): Promise<boolean> {
  return !!(await designRow(db))?.draft
}
