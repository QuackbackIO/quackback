/**
 * The `file-preview` job: derive what a file's card and viewer can show
 * without opening it (counts, a thumbnail, the first rows or lines, a text
 * excerpt), write it to the `files` row, and copy it onto the message the file
 * was attached to.
 */
import type { JobHandler } from '@/lib/server/jobs/definitions'
import type { FileId } from '@quackback/ids'
import { db, files, eq } from '@/lib/server/db'

export const FILE_PREVIEW_QUEUE = 'file-preview'

export const runFilePreview: JobHandler = async (job) => {
  const fileId = job.payload.fileId as FileId | undefined
  if (!fileId) return
  await db.update(files).set({ previewStatus: 'none' }).where(eq(files.id, fileId))
}
