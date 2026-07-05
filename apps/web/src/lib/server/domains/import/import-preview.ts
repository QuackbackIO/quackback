/**
 * Dry-run preview (§I2): validates and resolves every row exactly like the
 * commit path (`import-service.ts`), WITHOUT any writes — no tags, posts, or
 * users are created. Returns counts by board/status/author, a capped row
 * sample, and per-row errors so the wizard can show a "here's what would
 * happen" summary before the admin commits.
 */
import { db, postExternalLinks, eq, and, inArray } from '@/lib/server/db'
import { ValidationError } from '@/lib/shared/errors'
import type { ImportInput, ImportRowError, ImportPreview } from './types'
import { ImportUserResolver } from './user-resolver'
import { BATCH_SIZE, IMPORT_LINK_TYPE, loadRowContext, resolveRows } from './import-row-resolver'
import { parseCSV, validateImportInput, MAX_ERRORS } from './import-service'

export const MAX_PREVIEW_SAMPLE = 20

export async function previewImport(data: ImportInput): Promise<ImportPreview> {
  const validation = validateImportInput(data)
  if (!validation.success) {
    throw new ValidationError('VALIDATION_ERROR', `Invalid import data: ${validation.error}`)
  }

  const rows = parseCSV(data.csvContent)
  const ctx = await loadRowContext()
  const userResolver = new ImportUserResolver()
  const tagsToCreate = new Set<string>()

  const errors: ImportRowError[] = []
  const byBoard: Record<string, number> = {}
  const byStatus: Record<string, number> = {}
  const byAuthor: Record<string, number> = {}
  // sourceId travels with each sample row so the action (create/update) can
  // be corrected once the source-id lookup below runs; stripped before return.
  const sample: (ImportPreview['sample'][number] & { sourceId: string | null })[] = []

  // Source-id idempotence preview: rows carrying a source_id already linked
  // to a post will UPDATE rather than create on commit.
  const allSourceIds: string[] = []
  let totalRowsWithSourceId = 0

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const { validRows, errors: batchErrors } = await resolveRows(
      batch,
      data.boardId,
      i,
      userResolver,
      data.initiatedByPrincipalId,
      ctx,
      tagsToCreate
    )
    errors.push(...batchErrors)

    for (const { row, index } of validRows) {
      const boardKey = row.boardSlug ?? 'default'
      byBoard[boardKey] = (byBoard[boardKey] ?? 0) + 1
      const statusKey = row.statusLabel ?? 'default'
      byStatus[statusKey] = (byStatus[statusKey] ?? 0) + 1
      const authorKey = row.authorEmail ?? row.authorName ?? 'Imported user'
      byAuthor[authorKey] = (byAuthor[authorKey] ?? 0) + 1
      if (row.sourceId) {
        allSourceIds.push(row.sourceId)
        totalRowsWithSourceId++
      }

      if (sample.length < MAX_PREVIEW_SAMPLE) {
        sample.push({
          row: index,
          title: row.title,
          board: row.boardSlug,
          status: row.statusLabel,
          author: row.authorEmail ?? row.authorName ?? 'Imported user',
          isNewAuthor: row.isNewAuthor,
          voteCount: row.voteCount,
          action: 'create',
          sourceId: row.sourceId,
        })
      }
    }
  }

  const existingLinks =
    allSourceIds.length > 0
      ? await db.query.postExternalLinks.findMany({
          where: and(
            eq(postExternalLinks.integrationType, IMPORT_LINK_TYPE),
            inArray(postExternalLinks.externalId, allSourceIds)
          ),
        })
      : []
  const matchedSourceIds = new Set(existingLinks.map((l) => l.externalId))

  const finalSample = sample.map(({ sourceId, ...rest }) => ({
    ...rest,
    action: (sourceId && matchedSourceIds.has(sourceId) ? 'update' : 'create') as
      | 'create'
      | 'update',
  }))

  return {
    totalRows: data.totalRows,
    counts: { byBoard, byStatus, byAuthor },
    sample: finalSample,
    errors: errors.slice(0, MAX_ERRORS),
    // Every source-id-bearing row past the sample cap still counts toward
    // the summary total; matchedSourceIds only reflects rows we actually
    // saw (bounded by totalRowsWithSourceId), which is the full CSV either way.
    updatedCount: totalRowsWithSourceId > 0 ? matchedSourceIds.size : 0,
  }
}
