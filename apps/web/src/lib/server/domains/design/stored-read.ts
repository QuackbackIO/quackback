/**
 * Stored designs as this build reads them, and the guard that keeps this
 * build from writing back a design a newer build saved. After a blind
 * rollback such a design still renders, through the tolerant read, but
 * writing it back would lose what this build does not know, for good.
 */
import type { PortalDesignRevisionId } from '@quackback/ids'
import { db, eq, portalDesignRevisions, type Transaction } from '@/lib/server/db'
import { ConflictError } from '@/lib/shared/errors'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { readStoredDesign } from '@/lib/shared/design/stored-design'
import { logger } from '@/lib/server/logger'
import { withWelcomeImageRefs } from './welcome-images'

const log = logger.child({ module: 'design.stored' })

/**
 * A stored document as this build reads it, with whether a newer build saved
 * it: anything set aside says so. Null for a document that is not a design.
 */
export function storedRead(
  document: unknown,
  which: string
): { design: PortalDesign; newer: boolean } | null {
  const read = readStoredDesign(document)
  if (!read) {
    log.error({ which }, 'stored design no longer parses')
    return null
  }
  if (read.dropped.length > 0) {
    log.warn({ which, dropped: read.dropped }, 'stored design has fields this build does not know')
  }
  return { design: withWelcomeImageRefs(read.design), newer: read.dropped.length > 0 }
}

/**
 * A stored document as this build reads it. Fields a newer build added are set
 * aside, so a rollback keeps the brand; a document that is not a design at all
 * reads as null.
 */
export function storedDesign(document: unknown, which: string): PortalDesign | null {
  return storedRead(document, which)?.design ?? null
}

/** Whether a stored document holds anything this build would set aside on reading it. */
const savedByNewerBuild = (document: unknown) =>
  !!document && (readStoredDesign(document)?.dropped.length ?? 0) > 0

export const NEWER_FORMAT_MESSAGE =
  'A newer version of Quackback saved this design. Update Quackback to edit it.'

/**
 * Refuses a write while a newer build's design is stored: the draft, the
 * published version, or any other document the write reads, such as the
 * version being restored.
 */
export async function assertWritable(
  executor: typeof db | Transaction,
  row: { draft: unknown; publishedRevisionId: PortalDesignRevisionId | null },
  ...also: unknown[]
): Promise<void> {
  const [published] = row.publishedRevisionId
    ? await executor
        .select({ document: portalDesignRevisions.document })
        .from(portalDesignRevisions)
        .where(eq(portalDesignRevisions.id, row.publishedRevisionId))
        .limit(1)
    : []
  if ([row.draft, published?.document, ...also].some(savedByNewerBuild))
    throw new ConflictError('DESIGN_NEWER_FORMAT', NEWER_FORMAT_MESSAGE)
}
