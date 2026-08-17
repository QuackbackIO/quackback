/**
 * Like-for-like parity probe: the SAME file, run on the reference build and on
 * the queue-migration branch, against the SAME seeded database.
 *
 * It exists because the HTTP route to these queues is closed on both branches
 * by a pre-existing defect: a production build's API routes that call a server
 * function fail with `Server function info not found for 552eb43…`, reproduced
 * identically on `8310ee89d`, and `vite dev` cannot start on this machine
 * (`ENOSPC: System limit for number of file watchers reached`). So the probe
 * drives the same real producers the routes would, and reads the same rows the
 * routes' pollers would — the observable outcome, not the queue mechanism.
 *
 * It starts whichever consumer the tree has: the Postgres job tier if the
 * branch carries one, otherwise the BullMQ worker registry.
 *
 * Usage: DATABASE_URL=... bun run scripts/queue-parity-probe.ts <label>
 */
import postgres from 'postgres'
import { db, eq, importRuns, exportRuns } from '@/lib/server/db'
import { createId } from '@quackback/ids'

const DSN = process.env.DATABASE_URL ?? ''
if (!DSN) {
  console.error('DATABASE_URL is required')
  process.exit(2)
}
const LABEL = process.argv[2] ?? 'run'
const raw = postgres(DSN, { max: 4, onnotice: () => {} })
const STAMP = `parity-${LABEL}-${Date.now().toString(36)}`

function say(name: string, value: unknown): void {
  console.log(`${name.padEnd(44)} ${String(value)}`)
}

/**
 * This probe was written to run on two trees and compare them, so it used to
 * fall back to the queue-package worker registry when the job tier was absent.
 * That registry no longer exists in any tree, and the fallback could only ever
 * throw a module-not-found from inside a `catch` — turning a real job-tier
 * failure into an unrelated error. One consumer, and it is allowed to fail
 * loudly.
 */
async function startConsumer(): Promise<() => Promise<void>> {
  const tier = await import('@/lib/server/jobs/tier')
  await tier.startJobTier()
  say('consumer', 'postgres job tier')
  return () => tier.stopJobTier()
}

async function waitForStatus(
  table: 'import' | 'export',
  id: string,
  timeoutMs = 180_000
): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    // Through drizzle, not raw SQL: these ids are branded TypeIDs stored as
    // uuid, and the mapping lives in the schema.
    const rows =
      table === 'import'
        ? await db
            .select()
            .from(importRuns)
            .where(eq(importRuns.id, id as never))
        : await db
            .select()
            .from(exportRuns)
            .where(eq(exportRuns.id, id as never))
    const row = rows[0] as Record<string, unknown> | undefined
    if (row && row.status !== 'pending' && row.status !== 'running') return row
    await new Promise((r) => setTimeout(r, 1_000))
  }
  return null
}

async function main(): Promise<void> {
  const stop = await startConsumer()

  const [{ id: principalId }] = (await raw`
    SELECT id FROM principal WHERE role = 'admin' AND type = 'user' LIMIT 1
  `) as unknown as Array<{ id: string }>
  // Through drizzle so the id comes back as its branded TypeID: the importer
  // validates the `board_<base32>` form, not the stored uuid.
  const { boards, isNull, asc } = await import('@/lib/server/db')
  const [board] = await db
    .select({ id: boards.id })
    .from(boards)
    .where(isNull(boards.deletedAt))
    .orderBy(asc(boards.createdAt))
    .limit(1)
  const boardId = String(board.id)

  // ---- import ------------------------------------------------------------
  const csv = [
    'title,content',
    `${STAMP} one,imported by the parity probe`,
    `${STAMP} two,imported by the parity probe`,
  ].join('\n')

  const { createImportRun } = await import('@/lib/server/domains/import/import-run.service')
  const { enqueueImportCommitJob } = await import('@/lib/server/domains/import/import-queue')
  const importRun = await createImportRun({
    source: 'csv',
    fileName: `${STAMP}.csv`,
    initiatedByPrincipalId: principalId as never,
  } as never)
  await enqueueImportCommitJob({
    runId: importRun.id,
    source: 'csv',
    input: {
      boardId: boardId as never,
      csvContent: Buffer.from(csv).toString('base64'),
      totalRows: 2,
      initiatedByPrincipalId: principalId as never,
    },
  } as never)
  const importDone = await waitForStatus('import', String(importRun.id))
  say('import: terminal status', importDone?.status ?? 'TIMED OUT')
  say('import: created / failed', `${importDone?.created ?? '?'} / ${importDone?.failed ?? '?'}`)
  const [{ n: posts }] = (await raw`
    SELECT count(*)::int AS n FROM posts WHERE title LIKE ${STAMP + '%'}
  `) as unknown as Array<{ n: number }>
  say('import: posts visible afterwards', posts)

  // ---- export ------------------------------------------------------------
  const { createExportRun } = await import('@/lib/server/domains/export/export-run.service')
  const { enqueueWorkspaceExportJob } = await import('@/lib/server/domains/export/export-queue')
  let exportStatus: string
  let exportSize: unknown = '?'
  try {
    const exportRun = await createExportRun({
      fileName: `${STAMP}.zip`,
      initiatedByPrincipalId: principalId,
    } as never)
    await enqueueWorkspaceExportJob({
      runId: exportRun.id,
      workspaceSlug: 'parity',
    } as never)
    const exportDone = await waitForStatus('export', String(exportRun.id))
    exportStatus = String(exportDone?.status ?? 'TIMED OUT')
    exportSize = exportDone?.size_bytes ?? exportDone?.sizeBytes ?? '?'
  } catch (err) {
    exportStatus = `refused: ${err instanceof Error ? err.message : String(err)}`
  }
  say('export: terminal status', exportStatus)
  say('export: sizeBytes', exportSize)

  // ---- events ------------------------------------------------------------
  const [{ n: pubBefore }] = (await raw`
    SELECT count(*)::int AS n FROM events WHERE published_at IS NOT NULL
  `) as unknown as Array<{ n: number }>
  const { dispatchPostCreated } = await import('@/lib/server/events/dispatch')
  const postId = createId('post')
  // No post row is written: the fan-out under test is the outbox and its
  // consumers, and the hook targets resolve from the event payload.
  await dispatchPostCreated(
    { type: 'service', displayName: 'parity-probe' } as never,
    {
      id: postId,
      title: `${STAMP} event probe`,
      content: 'probe',
      boardId,
      boardSlug: 'probe',
      voteCount: 0,
    } as never
  )
  await new Promise((r) => setTimeout(r, 12_000))
  const [{ n: pubAfter }] = (await raw`
    SELECT count(*)::int AS n FROM events WHERE published_at IS NOT NULL
  `) as unknown as Array<{ n: number }>
  const [{ n: unpub }] = (await raw`
    SELECT count(*)::int AS n FROM events WHERE published_at IS NULL
  `) as unknown as Array<{ n: number }>
  const [{ n: deliveries }] = (await raw`
    SELECT count(*)::int AS n FROM hook_deliveries WHERE processed_at > now() - interval '3 minutes'
  `) as unknown as Array<{ n: number }>
  say('events: outbox rows published (delta)', pubAfter - pubBefore)
  say('events: outbox rows still unpublished', unpub)
  say('events: hook deliveries in the last 3m', deliveries)

  await stop()
  await raw.end()
  process.exit(0)
}

void main().catch(async (err) => {
  console.error(err)
  await raw.end().catch(() => {})
  process.exit(1)
})
