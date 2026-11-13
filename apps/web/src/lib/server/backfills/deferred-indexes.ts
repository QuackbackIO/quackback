/**
 * Background indexes: the indexes nothing needs at boot, built by the
 * `deferred-index-build` job after the server listens.
 *
 * `CONCURRENT_INDEX_SPECS` are built before the server listens, because a
 * boot-time or hot read needs them; an upgrade that skips releases builds all
 * of them first. Every other new index goes in `DEFERRED_INDEX_SPECS`, and its
 * readers work, slower, until it exists.
 *
 * ## One row per index, and when it is tried again
 *
 * Each schedule pass (and startup) enqueues one row per missing or invalid
 * index, under its own key `deferred-index-build:<index>:<gen>`. The dedupe
 * index covers finished rows until they are pruned, so one shared key would
 * block every later index for a week; a key per index does not.
 *
 * A row builds only its own index and retries by failing (`maxAttempts` 5).
 * When it fails for good, the pass enqueues a new generation only once that
 * row finished more than a day ago, and stops after five generations with one
 * warning that names the index. The first pass a worker process makes for a
 * workspace starts the count again, so restarting the worker is the retry and
 * nobody edits the database by hand.
 *
 * The build runs `CREATE INDEX CONCURRENTLY` on a connection of its own to the
 * workspace's direct endpoint: it cannot run inside a transaction, and a pooled
 * connection is no place for a statement that can take minutes.
 */
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import {
  DEFERRED_INDEX_SPECS,
  ensureConcurrentIndexes,
  type ConcurrentIndexSpec,
} from '@quackback/db/schema-ops'
import { config } from '@/lib/server/config'
import { db } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { kvGet, kvSet } from '@/lib/server/kv/pg-kv'
import { enqueueJob, findJobByDedupeKey } from '@/lib/server/jobs/job-queue'
import { getCurrentWorkspace } from '@/lib/server/workspaces/workspace-context'
import { resolveWorkspacePassword } from '@/lib/server/workspaces/pool-cache'
import { WorkspaceKeyedCache } from '@/lib/server/workspaces/workspace-keyed'
import { DURABLE_KV_TTL_SECONDS, maxAttemptsOf } from './batched'

const log = logger.child({ component: 'deferred-index-build' })

export const DEFERRED_INDEX_QUEUE = 'deferred-index-build'

/** Generations a failing build gets before the pass stops for it. */
export const MAX_INDEX_BUILD_ROUNDS = 5

/** How long after a generation's row ends before a failing build gets the next. */
export const INDEX_BUILD_COOL_OFF_MS = 24 * 60 * 60 * 1000

let overrides: readonly ConcurrentIndexSpec[] | null = null

/** The background indexes this build creates. */
export function deferredIndexSpecs(): readonly ConcurrentIndexSpec[] {
  return overrides ?? DEFERRED_INDEX_SPECS
}

/** Test seam: replace the background index list for one test. */
export function __setDeferredIndexSpecsForTests(specs: readonly ConcurrentIndexSpec[] | null): void {
  overrides = specs
}

/**
 * Workspaces this worker process has made its first pass for. That pass starts
 * every failing index's round count again: it is how a restart retries.
 */
const passedThisProcess = new WorkspaceKeyedCache<true>(10_000)
/** Indexes this process has already warned about, per workspace, so the warning is said once. */
const stopWarned = new WorkspaceKeyedCache<true>(10_000)

/** Test seam: behave as a freshly started worker process. */
export function __resetDeferredIndexPassesForTests(): void {
  passedThisProcess.clear()
  stopWarned.clear()
}

function indexKeys(index: string) {
  return {
    gen: `${DEFERRED_INDEX_QUEUE}:${index}:gen`,
    rounds: `${DEFERRED_INDEX_QUEUE}:${index}:rounds`,
  }
}

function dedupeKey(index: string, gen: number): string {
  return `${DEFERRED_INDEX_QUEUE}:${index}:${gen}`
}

/** The background indexes that are missing or invalid in this workspace. */
export async function pendingDeferredIndexes(): Promise<ConcurrentIndexSpec[]> {
  const specs = deferredIndexSpecs()
  if (specs.length === 0) return []
  const rows = (await db.execute(sql`
    SELECT s.name, i.indisvalid
    FROM jsonb_array_elements_text(${JSON.stringify(specs.map((s) => s.name))}::jsonb) AS s(name)
    LEFT JOIN pg_index i ON i.indexrelid = to_regclass(s.name)
  `)) as unknown as Array<{ name: string; indisvalid: boolean | null }>
  const built = new Set(rows.filter((r) => r.indisvalid === true).map((r) => r.name))
  return specs.filter((s) => !built.has(s.name))
}

async function enqueueBuild(index: string, gen: number, rounds: number): Promise<boolean> {
  const keys = indexKeys(index)
  await kvSet(keys.gen, gen, DURABLE_KV_TTL_SECONDS)
  await kvSet(keys.rounds, rounds, DURABLE_KV_TTL_SECONDS)
  const { inserted } = await enqueueJob({
    queue: DEFERRED_INDEX_QUEUE,
    dedupeKey: dedupeKey(index, gen),
    payload: { index, gen },
    maxAttempts: maxAttemptsOf(DEFERRED_INDEX_QUEUE),
  })
  return inserted
}

/**
 * The pass: what startup and every scheduled `deferred-index-build` row run.
 * Returns how many build rows it wrote.
 */
export async function enqueueDeferredIndexBuilds(now = Date.now()): Promise<number> {
  const pending = await pendingDeferredIndexes()
  const firstPass = !passedThisProcess.get('passed')
  let written = 0
  for (const spec of pending) {
    const keys = indexKeys(spec.name)
    const gen = (await kvGet<number>(keys.gen)) ?? 0
    if (gen === 0) {
      if (await enqueueBuild(spec.name, 1, 1)) written += 1
      continue
    }
    const row = await findJobByDedupeKey(DEFERRED_INDEX_QUEUE, dedupeKey(spec.name, gen))
    if (row && (row.status === 'pending' || row.status === 'running')) continue

    if (firstPass) {
      // A new worker process: the round count starts again, at once.
      if (await enqueueBuild(spec.name, gen + 1, 1)) written += 1
      continue
    }
    const rounds = (await kvGet<number>(keys.rounds)) ?? gen
    if (rounds >= MAX_INDEX_BUILD_ROUNDS) {
      if (!stopWarned.get(spec.name)) {
        stopWarned.set(spec.name, true)
        log.warn(
          { event: 'deferred_index.stopped', index: spec.name, rounds },
          'background index build failed every round and is stopped; restart the worker to try again'
        )
      }
      continue
    }
    const finishedAt = row ? await finishedAtOf(dedupeKey(spec.name, gen)) : null
    if (finishedAt && now - finishedAt.getTime() < INDEX_BUILD_COOL_OFF_MS) continue
    if (await enqueueBuild(spec.name, gen + 1, rounds + 1)) written += 1
  }
  passedThisProcess.set('passed', true)
  if (written > 0) {
    log.info({ event: 'deferred_index.enqueued', rows: written }, 'background index builds enqueued')
  }
  return written
}

async function finishedAtOf(key: string): Promise<Date | null> {
  const rows = (await db.execute(sql`
    SELECT finished_at FROM job_queue WHERE queue = ${DEFERRED_INDEX_QUEUE} AND dedupe_key = ${key}
  `)) as unknown as Array<{ finished_at: Date | string | null }>
  const value = rows[0]?.finished_at ?? null
  return value === null ? null : new Date(value)
}

/**
 * The `deferred-index-build` schedule gate: open while a background index is
 * missing or invalid and this process may still enqueue it. Shut, with no
 * query, when the build has no background index.
 */
export async function deferredIndexBuildDue(): Promise<boolean> {
  const pending = await pendingDeferredIndexes()
  if (pending.length === 0) return false
  if (!passedThisProcess.get('passed')) return true
  for (const spec of pending) {
    const rounds = (await kvGet<number>(indexKeys(spec.name).rounds)) ?? 0
    if (rounds < MAX_INDEX_BUILD_ROUNDS) return true
  }
  return false
}

/**
 * Build one background index on a connection of its own to this workspace's
 * database, dropping an invalid copy first. A second build of a valid index
 * changes nothing.
 */
export async function buildDeferredIndex(spec: ConcurrentIndexSpec): Promise<void> {
  const direct = openDirectConnection()
  try {
    await ensureConcurrentIndexes(direct, [spec], (event) => {
      if (event.phase === 'start') {
        log.info(
          { event: 'deferred_index.build_started', index: event.name, reason: event.reason },
          'building background index'
        )
      } else {
        log.info(
          { event: 'deferred_index.built', index: event.name, duration_ms: event.durationMs },
          'background index built'
        )
      }
    })
  } finally {
    await direct.end({ timeout: 5 }).catch(() => {})
  }
}

/** A connection of its own to this workspace's database, for one concurrent build. */
function openDirectConnection(): postgres.Sql {
  const workspace = getCurrentWorkspace()
  if (workspace) {
    return postgres(workspace.database.directUrl, {
      max: 1,
      connect_timeout: 15,
      password: () => resolveWorkspacePassword(workspace),
      onnotice: () => {},
    })
  }
  if (!config.databaseUrl) throw new Error('DATABASE_URL is not set')
  return postgres(config.databaseUrl, { max: 1, onnotice: () => {} })
}
