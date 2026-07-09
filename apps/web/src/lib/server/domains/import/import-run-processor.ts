/**
 * Async import commit job (§I1).
 *
 * Owns an import run's running -> completed|failed transition. Kept separate
 * from the BullMQ wrapper (`import-queue.ts`) so the orchestration itself is
 * unit-testable without Redis: the worker's job handler is a thin call into
 * `runImportCommitJob`.
 */
import type { ImportRunId, PrincipalId } from '@quackback/ids'
import { db, eq, principal, user, type ImportRunSource } from '@/lib/server/db'
import type { ImportInput } from './types'
import { processImport } from './import-service'
import {
  ensureBatchTag,
  markImportRunRunning,
  completeImportRun,
  failImportRun,
} from './import-run.service'
import { recordAuditEvent, type AuditActorType } from '@/lib/server/audit/log'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'import-run-processor' })

export interface ImportCommitJobData {
  runId: ImportRunId
  source: ImportRunSource
  input: ImportInput
}

/**
 * Executed by the queue worker. Creates (or reuses) the day's batch tag,
 * flips the run to `running`, delegates to the existing CSV pipeline, then
 * writes back totals + the capped error report. A thrown error anywhere in
 * this path fails the run rather than the process — the worker registry's
 * job-level retry is disabled for this queue (see import-queue.ts): source-id
 * idempotence only covers rows that carry one, so a blind retry could still
 * double-import the rest of the batch.
 */
export async function runImportCommitJob(data: ImportCommitJobData): Promise<void> {
  const { runId, source, input } = data
  try {
    const batchTag = await ensureBatchTag(source)
    await markImportRunRunning(runId, batchTag.id)

    const result = await processImport({ ...input, batchTagId: batchTag.id })

    await completeImportRun(
      runId,
      {
        rows: input.totalRows,
        created: result.imported,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors.length,
      },
      result.errors
    )

    // ONE summary event per run that asserted verified emails (per-row events
    // would flood the log on large imports). Asserting emailVerified grants
    // portal access, so the trail records who ran the import and how many
    // users it vouched for.
    if (result.verifiedAuthorsCreated > 0) {
      await recordVerifiedEmailSummary(
        input.initiatedByPrincipalId,
        runId,
        source,
        result.verifiedAuthorsCreated
      )
    }
  } catch (error) {
    log.error({ err: error, run_id: runId }, 'import commit job failed')
    await failImportRun(runId, error instanceof Error ? error.message : 'Import failed')
  }
}

/**
 * Emit the per-run `import.email_verified.asserted` summary. The queue worker
 * has no request context, so the actor is reconstructed from the run's
 * initiating principal.
 */
async function recordVerifiedEmailSummary(
  initiatedByPrincipalId: PrincipalId,
  runId: ImportRunId,
  source: ImportRunSource,
  count: number
): Promise<void> {
  const initiator = await db.query.principal.findFirst({
    where: eq(principal.id, initiatedByPrincipalId),
    columns: { userId: true, role: true, type: true },
  })
  const initiatorUser = initiator?.userId
    ? await db.query.user.findFirst({
        where: eq(user.id, initiator.userId),
        columns: { email: true },
      })
    : null

  await recordAuditEvent({
    event: 'import.email_verified.asserted',
    actor: {
      userId: initiator?.userId ?? null,
      email: initiatorUser?.email ?? null,
      role: initiator?.role ?? null,
      type: (initiator?.type as AuditActorType | undefined) ?? null,
    },
    target: { type: 'import_run', id: runId },
    after: { emailVerified: true },
    metadata: { source, count },
  })
}
