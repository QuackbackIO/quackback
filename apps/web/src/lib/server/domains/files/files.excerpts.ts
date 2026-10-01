/**
 * Read-only lookup of a file's extracted text excerpt, for Quinn's thread
 * mapper (assistant.thread.ts) — the only consumer, and the reason this lives
 * apart from files.service.ts rather than adding to it. `textExcerpt` is
 * written by the file-preview job; the other three columns name the file and
 * say whether an excerpt can ever be expected.
 */
import { and, db, files, inArray, isNull } from '@/lib/server/db'
import type { FileId } from '@quackback/ids'
import type { FileFamily } from '@/lib/shared/files/file-types'

export interface FileExcerptRow {
  id: string
  name: string
  family: FileFamily
  /** pending | ready | failed | none. */
  previewStatus: string
  textExcerpt: string | null
}

/**
 * Load the excerpt-bearing columns for a set of file ids, in one query.
 * Deleted files and ids with no row are simply absent from the result — never
 * thrown — so a caller folding this into a best-effort grounding step never
 * needs its own not-found branch.
 */
export async function loadFileExcerpts(
  fileIds: readonly FileId[]
): Promise<Map<string, FileExcerptRow>> {
  if (fileIds.length === 0) return new Map()
  const rows = await db
    .select({
      id: files.id,
      name: files.name,
      family: files.family,
      previewStatus: files.previewStatus,
      textExcerpt: files.textExcerpt,
    })
    .from(files)
    .where(and(inArray(files.id, fileIds as FileId[]), isNull(files.deletedAt)))
  return new Map(
    rows.map((row) => [row.id as string, { ...row, family: row.family as FileFamily }])
  )
}
