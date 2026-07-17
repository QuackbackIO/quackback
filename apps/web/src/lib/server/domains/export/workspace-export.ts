/**
 * Workspace export orchestrator: stream every core entity through the ZIP
 * builder, upload the archive to S3, and (on any worker visit) sweep stale
 * and expired runs.
 *
 * Entities are offset-paged ordered by created_at, so rows created mid-run
 * may be picked up or missed — the export is a close-enough snapshot, not a
 * point-in-time transaction. manifest.json is written last because it carries
 * the per-entity counts gathered while streaming.
 */
import type { ExportRunId } from '@quackback/ids'
import { uploadObject, deleteObject } from '@/lib/server/storage/s3'
import { logger } from '@/lib/server/logger'
import { ZipBuilder } from './zip'
import type { EntityExporter, WorkspaceExportManifest, WorkspaceExportResult } from './types'
import { boardsExporter, statusesExporter, tagsExporter } from './entities/taxonomy'
import { postsExporter } from './entities/posts'
import { commentsExporter } from './entities/comments'
import { votesExporter } from './entities/votes'
import { createUsersExporter } from './entities/users'
import { companiesExporter } from './entities/companies'
import { conversationsExporter } from './entities/conversations'
import { changelogExporter } from './entities/changelog'
import { kbArticlesExporter } from './entities/kb'
import {
  failStaleActiveRuns,
  listExpiredCompletedRuns,
  deleteExportRun,
} from './export-run.service'

const log = logger.child({ component: 'workspace-export' })

/** Built per run: some exporters carry per-run paging state (users). */
function buildEntityList(): EntityExporter[] {
  return [
    boardsExporter,
    statusesExporter,
    tagsExporter,
    postsExporter,
    commentsExporter,
    votesExporter,
    createUsersExporter(),
    companiesExporter,
    conversationsExporter,
    changelogExporter,
    kbArticlesExporter,
  ]
}

export async function buildWorkspaceExport(
  runId: ExportRunId,
  workspaceSlug: string
): Promise<WorkspaceExportResult> {
  const zip = new ZipBuilder()
  const entityCounts: Record<string, number> = {}

  for (const entity of buildEntityList()) {
    const file = zip.file(entity.fileName)
    if (entity.header) file.write(entity.header + '\n')

    let offset = 0
    let count = 0
    for (;;) {
      const rows = await entity.fetchPage(offset, entity.pageSize)
      if (rows.length > 0) {
        file.write(rows.map((row) => entity.serialize(row)).join('\n') + '\n')
      }
      count += rows.length
      if (rows.length < entity.pageSize) break
      offset += entity.pageSize
    }
    file.close()

    entityCounts[entity.key] = count
    log.info({ entity: entity.key, rows: count }, 'entity exported')
  }

  const manifest: WorkspaceExportManifest = {
    format_version: 1,
    generator: 'quackback',
    workspace_slug: workspaceSlug,
    exported_at: new Date().toISOString(),
    entities: entityCounts,
  }
  const manifestFile = zip.file('manifest.json')
  manifestFile.write(JSON.stringify(manifest, null, 2))
  manifestFile.close()

  const buffer = zip.finish()
  const s3Key = `exports/${runId}.zip`
  await uploadObject(s3Key, buffer, 'application/zip')

  log.info({ run_id: runId, size_bytes: buffer.length, entities: entityCounts }, 'export uploaded')
  return { s3Key, sizeBytes: buffer.length, entityCounts }
}

/**
 * Post-run sweep: fail runs orphaned by a worker restart (frees the
 * single-active-run slot), then delete expired artifacts + their rows.
 * Best effort — object deletions that fail keep their row for the next sweep.
 */
export async function cleanupExpiredExports(): Promise<void> {
  const stale = await failStaleActiveRuns()
  if (stale.length > 0) {
    log.warn({ run_ids: stale }, 'failed stale export runs')
  }

  const expired = await listExpiredCompletedRuns()
  for (const run of expired) {
    if (run.s3Key) {
      try {
        await deleteObject(run.s3Key)
      } catch (error) {
        log.error(
          { err: error, run_id: run.id, s3_key: run.s3Key },
          'expired artifact delete failed'
        )
        continue
      }
    }
    await deleteExportRun(run.id)
  }
  if (expired.length > 0) {
    log.info({ deleted: expired.length }, 'expired exports cleaned up')
  }
}
