/**
 * Import and export history (Settings > Imports & exports, and the export
 * action on Settings > General), as server functions so the pages' loaders
 * can warm them into the document. The gates are those of the REST reads they
 * stand beside (`GET /api/export/runs`, `GET /api/import/runs`).
 */
import { createServerFn } from '@tanstack/react-start'
import type { ExportRunEntityCounts, ImportRunErrorEntry, ImportRunTotals } from '@/lib/server/db'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { isAdmin } from '@/lib/shared/roles'
import { toIsoStringOrNull } from '@/lib/shared/utils/date'
import { requireAuth } from './auth-helpers'

export interface ExportRunListItem {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  fileName: string
  sizeBytes: number | null
  entityCounts: ExportRunEntityCounts | null
  error: string | null
  createdAt: string
  finishedAt: string | null
  expiresAt: string | null
}

export interface ImportRunListItem {
  id: string
  source: 'csv' | 'uservoice' | 'canny' | 'api'
  fileName: string
  status: 'pending' | 'dry_run' | 'running' | 'completed' | 'failed'
  totals: ImportRunTotals | null
  errorReport: ImportRunErrorEntry[] | null
  createdAt: string
  finishedAt: string | null
}

/** Workspace export runs, newest first. */
export const listExportRunsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ExportRunListItem[]> => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    const { listExportRuns } = await import('@/lib/server/domains/export/export-run.service')
    return (await listExportRuns()).map((run) => ({
      id: run.id,
      status: run.status,
      fileName: run.fileName,
      sizeBytes: run.sizeBytes,
      entityCounts: run.entityCounts,
      error: run.error,
      createdAt: run.createdAt.toISOString(),
      finishedAt: toIsoStringOrNull(run.finishedAt),
      expiresAt: toIsoStringOrNull(run.expiresAt),
    }))
  }
)

/** Import runs, newest first. Admins only, like the rest of the import run reads. */
export const listImportRunsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ImportRunListItem[]> => {
    const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    if (!isAdmin(auth.principal.role)) {
      throw new Error('Access denied: Only admins can view import history')
    }
    const { listImportRuns } = await import('@/lib/server/domains/import/import-run.service')
    return (await listImportRuns()).map((run) => ({
      id: run.id,
      source: run.source,
      fileName: run.fileName,
      status: run.status,
      totals: run.totals,
      errorReport: run.errorReport,
      createdAt: run.createdAt.toISOString(),
      finishedAt: toIsoStringOrNull(run.finishedAt),
    }))
  }
)
