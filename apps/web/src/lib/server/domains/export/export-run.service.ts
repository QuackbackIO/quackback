/**
 * Export run bookkeeping (Imports & exports hub — workspace data export).
 *
 * One row per async export job. The worker owns the pending -> running ->
 * completed|failed transition; the hub polls the row for status, size, and
 * per-entity counts. Completed artifacts expire after EXPORT_RETENTION_DAYS —
 * the download route enforces expires_at, and the worker's post-run cleanup
 * deletes the row + S3 object.
 */
import { db, exportRuns, eq, desc, and, inArray, lt } from '@/lib/server/db'
import type { ExportRunStatus, ExportRunEntityCounts } from '@/lib/server/db'
import { createId } from '@quackback/ids'
import type { ExportRunId, PrincipalId } from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'

/** Days a completed artifact stays downloadable. */
export const EXPORT_RETENTION_DAYS = 7
/**
 * A run stuck in pending/running this long is considered orphaned (worker
 * restart mid-job; the queue is attempts: 1). Cleanup fails it so the
 * single-active-run unique index never wedges future exports.
 */
export const STALE_ACTIVE_MS = 60 * 60 * 1000

export interface ExportRunRecord {
  id: ExportRunId
  status: ExportRunStatus
  fileName: string
  s3Key: string | null
  sizeBytes: number | null
  entityCounts: ExportRunEntityCounts | null
  error: string | null
  initiatedByPrincipalId: PrincipalId
  createdAt: Date
  finishedAt: Date | null
  expiresAt: Date | null
}

export interface CreateExportRunInput {
  fileName: string
  initiatedByPrincipalId: PrincipalId
}

/**
 * Create the run row in `pending` state. Called synchronously from the route
 * so the caller gets a run id back immediately. The partial unique index on
 * active runs makes a second concurrent insert fail with a unique violation —
 * the route maps that to 409.
 */
export async function createExportRun(input: CreateExportRunInput): Promise<ExportRunRecord> {
  const id = createId('export_run')
  const [row] = await db
    .insert(exportRuns)
    .values({
      id,
      fileName: input.fileName,
      initiatedByPrincipalId: input.initiatedByPrincipalId,
      status: 'pending',
    })
    .returning()
  return row as ExportRunRecord
}

export async function getExportRun(id: ExportRunId): Promise<ExportRunRecord> {
  const row = await db.query.exportRuns.findFirst({ where: eq(exportRuns.id, id) })
  if (!row) {
    throw new NotFoundError('EXPORT_RUN_NOT_FOUND', `Export run ${id} not found`)
  }
  return row as ExportRunRecord
}

/** Export history, newest first. Capped: the hub shows recent runs, not a full audit trail. */
export async function listExportRuns(limit = 20): Promise<ExportRunRecord[]> {
  const rows = await db.query.exportRuns.findMany({
    orderBy: desc(exportRuns.createdAt),
    limit,
  })
  return rows as ExportRunRecord[]
}

/** The in-flight run, if any (at most one can exist — see the unique index). */
export async function findActiveExportRun(): Promise<ExportRunRecord | null> {
  const row = await db.query.exportRuns.findFirst({
    where: inArray(exportRuns.status, ['pending', 'running']),
    orderBy: desc(exportRuns.createdAt),
  })
  return (row as ExportRunRecord) ?? null
}

export async function markExportRunRunning(id: ExportRunId): Promise<void> {
  await db.update(exportRuns).set({ status: 'running' }).where(eq(exportRuns.id, id))
}

export interface CompleteExportRunInput {
  s3Key: string
  sizeBytes: number
  entityCounts: ExportRunEntityCounts
}

export async function completeExportRun(
  id: ExportRunId,
  input: CompleteExportRunInput
): Promise<void> {
  const now = new Date()
  await db
    .update(exportRuns)
    .set({
      status: 'completed',
      s3Key: input.s3Key,
      sizeBytes: input.sizeBytes,
      entityCounts: input.entityCounts,
      finishedAt: now,
      expiresAt: new Date(now.getTime() + EXPORT_RETENTION_DAYS * 24 * 60 * 60 * 1000),
    })
    .where(eq(exportRuns.id, id))
}

export async function failExportRun(id: ExportRunId, message: string): Promise<void> {
  await db
    .update(exportRuns)
    .set({ status: 'failed', error: message, finishedAt: new Date() })
    .where(eq(exportRuns.id, id))
}

/**
 * Fail active runs orphaned longer than STALE_ACTIVE_MS. Returns the ids it
 * failed (their S3 objects, if any, are partial and never linked — nothing
 * to delete).
 */
export async function failStaleActiveRuns(now = new Date()): Promise<ExportRunId[]> {
  const cutoff = new Date(now.getTime() - STALE_ACTIVE_MS)
  const rows = await db
    .update(exportRuns)
    .set({
      status: 'failed',
      error: 'Export worker restarted before the run finished',
      finishedAt: now,
    })
    .where(
      and(inArray(exportRuns.status, ['pending', 'running']), lt(exportRuns.createdAt, cutoff))
    )
    .returning({ id: exportRuns.id })
  return rows.map((r) => r.id)
}

/** Completed runs past their download expiry. */
export async function listExpiredCompletedRuns(now = new Date()): Promise<ExportRunRecord[]> {
  const rows = await db.query.exportRuns.findMany({
    where: and(eq(exportRuns.status, 'completed'), lt(exportRuns.expiresAt, now)),
  })
  return rows as ExportRunRecord[]
}

export async function deleteExportRun(id: ExportRunId): Promise<void> {
  await db.delete(exportRuns).where(eq(exportRuns.id, id))
}
