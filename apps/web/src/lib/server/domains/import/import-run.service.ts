/**
 * Import run bookkeeping (Imports & exports hub, §I1).
 *
 * One row per async import job. The worker owns the pending -> running ->
 * completed|failed transition; dry runs never create a row (no writes to
 * report). The batch tag is created once, at commit start, and its id is
 * stored on the run so history stays linkable even if the tag is renamed.
 */
import { db, importRuns, postTags, eq, desc } from '@/lib/server/db'
import type {
  ImportRunSource,
  ImportRunStatus,
  ImportRunTotals,
  ImportRunErrorEntry,
} from '@/lib/server/db'
import { createId } from '@quackback/ids'
import type { ImportRunId, PrincipalId, PostTagId } from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'

export interface ImportRunRecord {
  id: ImportRunId
  source: ImportRunSource
  fileName: string
  initiatedByPrincipalId: PrincipalId
  status: ImportRunStatus
  totals: ImportRunTotals | null
  errorReport: ImportRunErrorEntry[] | null
  batchTagId: PostTagId | null
  createdAt: Date
  finishedAt: Date | null
}

export interface CreateImportRunInput {
  source: ImportRunSource
  fileName: string
  initiatedByPrincipalId: PrincipalId
}

/** Create the run row in `pending` state. Called synchronously from the route so the caller gets a run id back immediately. */
export async function createImportRun(input: CreateImportRunInput): Promise<ImportRunRecord> {
  const id = createId('import_run')
  const [row] = await db
    .insert(importRuns)
    .values({
      id,
      source: input.source,
      fileName: input.fileName,
      initiatedByPrincipalId: input.initiatedByPrincipalId,
      status: 'pending',
    })
    .returning()
  return row as ImportRunRecord
}

export async function markImportRunRunning(
  id: ImportRunId,
  batchTagId: PostTagId | null
): Promise<void> {
  await db.update(importRuns).set({ status: 'running', batchTagId }).where(eq(importRuns.id, id))
}

export async function completeImportRun(
  id: ImportRunId,
  totals: ImportRunTotals,
  errorReport: ImportRunErrorEntry[]
): Promise<void> {
  await db
    .update(importRuns)
    .set({ status: 'completed', totals, errorReport, finishedAt: new Date() })
    .where(eq(importRuns.id, id))
}

export async function failImportRun(id: ImportRunId, message: string): Promise<void> {
  await db
    .update(importRuns)
    .set({
      status: 'failed',
      errorReport: [{ row: 0, message }],
      finishedAt: new Date(),
    })
    .where(eq(importRuns.id, id))
}

export async function getImportRun(id: ImportRunId): Promise<ImportRunRecord> {
  const row = await db.query.importRuns.findFirst({ where: eq(importRuns.id, id) })
  if (!row) {
    throw new NotFoundError('IMPORT_RUN_NOT_FOUND', `Import run ${id} not found`)
  }
  return row as ImportRunRecord
}

/** Import history, newest first. Capped: the hub shows recent runs, not a full audit trail. */
export async function listImportRuns(limit = 50): Promise<ImportRunRecord[]> {
  const rows = await db.query.importRuns.findMany({
    orderBy: desc(importRuns.createdAt),
    limit,
  })
  return rows as ImportRunRecord[]
}

/** `import-{source}-{yyyy-mm-dd}`, e.g. `import-csv-2026-07-05`. */
export function buildBatchTagName(source: ImportRunSource, now: Date = new Date()): string {
  return `import-${source}-${now.toISOString().slice(0, 10)}`
}

/**
 * Get-or-create the batch tag for a run. Reused across a single UTC day so
 * multiple imports run back to back land on one findable tag, not a new tag
 * per run.
 */
export async function ensureBatchTag(
  source: ImportRunSource
): Promise<{ id: PostTagId; name: string }> {
  const name = buildBatchTagName(source)
  const existing = await db.query.postTags.findFirst({ where: eq(postTags.name, name) })
  if (existing) {
    return { id: existing.id as PostTagId, name }
  }
  const id = createId('post_tag')
  await db.insert(postTags).values({ id, name, color: '#6b7280' })
  return { id, name }
}
