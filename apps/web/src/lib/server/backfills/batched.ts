/**
 * Startup backfills: data changes over hot tables, run as background jobs in
 * short batches after the server listens, never inside a numbered migration.
 *
 * `conversations`, `tickets`, `conversation_messages` and `events` grow large.
 * A migration that updates every row of one holds its locks, and the whole
 * migration lineage, for as long as the update takes. So a backfill over them
 * is registered here instead (see `packages/db/MIGRATIONS.md`), and its readers
 * tolerate rows it has not reached yet.
 *
 * ## How a backfill runs
 *
 * - **Enqueue only.** Startup and every schedule pass of the `startup-backfill`
 *   job enqueue one deduped row per backfill whose "done" marker is unset and
 *   whose migration this workspace has applied. A dedupe hit writes nothing, so
 *   every boot, replica and pass can ask. Nothing walks on the boot path.
 * - **The walk.** A row walks the table by `id` in batches. Each batch is one
 *   short transaction: a transaction-scoped try-lock, the step, the cursor. The
 *   lock is released by the commit or rollback, so nothing can strand it behind
 *   a transaction-mode pooler the way a session lock can. A runner that cannot
 *   take it (a reaped runner still finishing a batch) throws, and the queue puts
 *   the same row back to `pending` with backoff. The last batch writes the
 *   "done" marker and enqueues the follow-up, if there is one.
 * - **Retry by failing.** A failed batch, a held lock or a missing migration
 *   throws, and the row is retried with backoff from the cursor. When a row
 *   fails for good before "done" is set, the next pass enqueues a new
 *   generation (the dedupe key carries it), so the walk never stops for good.
 * - **State in kv.** The cursor, the "done" marker and the generation live in
 *   `kv_store`, whose rows always expire; they are written with a ten-year
 *   expiry. A backfill is idempotent, so a marker that did expire only runs a
 *   walk that changes nothing.
 *
 * ## The ticket edit time
 *
 * A step that updates `tickets` keeps `updated_at` as it was: a Drizzle update
 * sets `updatedAt: sql\`${tickets.updatedAt}\`` (the column's `$onUpdate` would
 * otherwise bump it), and raw SQL leaves the column out of `SET`. The "recent"
 * ticket list, search ranking, the REST `updatedAfter` sync and the retention
 * clock all read it. Each walk supplies a `fixture` that seeds rows its step
 * must change and returns the check of the result; the shared backfill test
 * runs every registered walk on its fixture and checks both.
 */
import { sql } from 'drizzle-orm'
import { db, type Database, type Transaction } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { kvGet, kvSet } from '@/lib/server/kv/pg-kv'
import { enqueueJob, findJobByDedupeKey } from '@/lib/server/jobs/job-queue'
import { WorkspaceKeyedCache } from '@/lib/server/workspaces/workspace-keyed'
import { findJobDefinition, maxAttemptsFor } from '@/lib/server/jobs/definitions'
import { migrationApplied } from './schema-floor'
import { BATCHED_BACKFILLS } from './registry'

const log = logger.child({ component: 'startup-backfill' })

/**
 * Ten years. `kv_store` rows always expire, and the markers and cursors here
 * must outlive any upgrade; one that does expire only re-runs idempotent work.
 */
export const DURABLE_KV_TTL_SECONDS = 10 * 365 * 24 * 60 * 60

/** The attempts a queue's definition allows, for rows enqueued outside its schedule. */
export function maxAttemptsOf(queue: string): number {
  const def = findJobDefinition(queue)
  if (!def) throw new Error(`no job definition for queue ${queue}`)
  return maxAttemptsFor(def)
}

/** The queue that walks backfills. Its scheduled rows run the enqueue pass. */
export const BACKFILL_QUEUE = 'startup-backfill'

/** Queues a backfill's follow-up may run on. Each runs `runBackfillFollowUpJob`. */
export const FOLLOW_UP_QUEUES = ['ticket-frt-reconcile'] as const
export type FollowUpQueue = (typeof FOLLOW_UP_QUEUES)[number]

/** What a fixture seeds with, and what a verify reads through. */
export type BackfillDb = Database | Transaction

/** The `id` range of one batch, as raw uuid text: `fromId < id <= toId`. */
export interface BackfillRange {
  /** Null on the first batch. */
  fromId: string | null
  toId: string
}

export interface BackfillFixtureContext {
  /** The `updated_at` every ticket the fixture seeds must carry. */
  ticketUpdatedAt: Date
}

/** Reads the result a walk was meant to produce. True when it did. */
export type BackfillVerify = (db: BackfillDb) => Promise<boolean>

/** One table walk: the backfill itself, or the follow-up it registers. */
export interface BackfillWalk {
  /** The table whose `id` (a uuid primary key) is walked. */
  table: string
  /** Rows per batch transaction. */
  batchSize: number
  /** A pause between batches, so a long walk leaves room for other work. */
  pauseMs?: number
  /**
   * Change the rows in `range`. Runs inside the batch transaction, which also
   * advances the cursor, so a batch is applied exactly when its cursor moves.
   * Must be idempotent, and must keep `tickets.updated_at` (see above).
   */
  step: (tx: Transaction, range: BackfillRange) => Promise<void>
  /**
   * Seed rows the step must change (tickets with `ctx.ticketUpdatedAt`), and
   * return the check that the walk changed them as intended.
   */
  fixture: (db: BackfillDb, ctx: BackfillFixtureContext) => Promise<BackfillVerify>
}

export interface BackfillFollowUp extends BackfillWalk {
  queue: FollowUpQueue
  /** How long after the walk finishes the follow-up is due. */
  delayMs: number
  /** The migration the follow-up needs. Defaults to the backfill's. */
  requiresMigration?: string
}

export interface BatchedBackfill extends BackfillWalk {
  /** Stable name: the kv keys, the dedupe keys and the lock derive from it. */
  name: string
  /** Journal tag of the migration the step needs (`0312_add_column`). */
  requiresMigration: string
  followUp?: BackfillFollowUp
}

let overrides: readonly BatchedBackfill[] | null = null

/** The backfills this build runs. */
export function registeredBackfills(): readonly BatchedBackfill[] {
  return overrides ?? BATCHED_BACKFILLS
}

/** Test seam: replace the registry for one test. */
export function __setBackfillsForTests(entries: readonly BatchedBackfill[] | null): void {
  overrides = entries
}

export function findBackfill(name: string): BatchedBackfill | undefined {
  return registeredBackfills().find((b) => b.name === name)
}

export interface WalkKeys {
  cursor: string
  done: string
  gen: string
}

export function backfillKeys(name: string): WalkKeys {
  return {
    cursor: `backfill:${name}:cursor`,
    done: `backfill:${name}:done`,
    gen: `backfill:${name}:gen`,
  }
}

export function followUpKeys(name: string): WalkKeys {
  return {
    cursor: `backfill:${name}:follow-up:cursor`,
    done: `backfill:${name}:follow-up:done`,
    gen: `backfill:${name}:follow-up:gen`,
  }
}

/** Thrown when another runner holds this backfill's lock. The row is retried. */
export class BackfillBusyError extends Error {
  constructor(lock: string) {
    super(`another runner holds ${lock}; retrying later`)
    this.name = 'BackfillBusyError'
  }
}

/** Thrown when this workspace lacks the migration a walk needs. The row is retried. */
export class BackfillMigrationMissingError extends Error {
  constructor(name: string, tag: string) {
    super(`backfill ${name} waits for migration ${tag}, which this workspace has not applied`)
    this.name = 'BackfillMigrationMissingError'
  }
}

async function isDone(key: string): Promise<boolean> {
  return (await kvGet(key)) !== null
}

/**
 * Enqueue the current generation of one walk, or a new generation when the
 * current one's row is terminal. A live row (pending or running) is left
 * alone. Returns true when a row was written.
 */
async function enqueueGeneration(opts: {
  queue: string
  name: string
  genKey: string
  runAt?: Date
}): Promise<boolean> {
  let gen = (await kvGet<number>(opts.genKey)) ?? 1
  const row = await findJobByDedupeKey(opts.queue, dedupeKeyFor(opts.queue, opts.name, gen))
  if (row && (row.status === 'pending' || row.status === 'running')) return false
  if (row) {
    gen += 1
    await kvSet(opts.genKey, gen, DURABLE_KV_TTL_SECONDS)
  }
  const { inserted } = await enqueueJob({
    queue: opts.queue,
    dedupeKey: dedupeKeyFor(opts.queue, opts.name, gen),
    payload: { name: opts.name, gen },
    maxAttempts: maxAttemptsOf(opts.queue),
    runAt: opts.runAt,
  })
  return inserted
}

function dedupeKeyFor(queue: string, name: string, gen: number): string {
  return queue === BACKFILL_QUEUE ? `backfill:${name}:${gen}` : `${queue}:${name}:${gen}`
}

/**
 * The enqueue pass: what startup runs and what every scheduled
 * `startup-backfill` row runs. Writes a row for each backfill (or follow-up)
 * that is not done, whose migration this workspace has, and whose current row
 * is missing or terminal. Returns how many rows it wrote.
 */
export async function enqueueBackfillPass(): Promise<number> {
  let written = 0
  for (const entry of registeredBackfills()) {
    const keys = backfillKeys(entry.name)
    if (!(await isDone(keys.done))) {
      if (!(await migrationApplied(entry.requiresMigration))) continue
      if (await enqueueGeneration({ queue: BACKFILL_QUEUE, name: entry.name, genKey: keys.gen })) {
        written += 1
      }
      continue
    }
    const followUp = entry.followUp
    if (!followUp) continue
    const fkeys = followUpKeys(entry.name)
    if (await isDone(fkeys.done)) continue
    if (!(await migrationApplied(followUp.requiresMigration ?? entry.requiresMigration))) continue
    if (await enqueueGeneration({ queue: followUp.queue, name: entry.name, genKey: fkeys.gen })) {
      written += 1
    }
  }
  if (written > 0)
    log.info({ event: 'backfill.enqueued', rows: written }, 'startup backfills enqueued')
  return written
}

/** A table name that is safe to put in an identifier. */
function tableIdentifier(table: string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error(`invalid backfill table "${table}"`)
  return sql.identifier(table)
}

/**
 * Walk one table in batches until the done marker is set.
 *
 * The marker is read once, before the first batch. Each batch transaction then
 * takes the try-lock, reads the cursor, runs the step and moves the cursor.
 * `onFinish` runs inside the last batch's transaction, so the done marker and
 * whatever the finish enqueues commit together. A walk that races another
 * runner to the end finds no rows left and writes the same marker again.
 */
async function walk(opts: {
  label: string
  lock: string
  keys: WalkKeys
  walk: BackfillWalk
  onFinish?: (tx: Transaction) => Promise<void>
}): Promise<void> {
  const table = tableIdentifier(opts.walk.table)
  const batchSize = Math.max(1, Math.floor(opts.walk.batchSize))
  if (await isDone(opts.keys.done)) return
  let batches = 0
  for (;;) {
    const finished = await db.transaction(async (tx) => {
      const lock = (await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(hashtext(${opts.lock})) AS locked`
      )) as unknown as Array<{ locked: boolean }>
      if (!lock[0]?.locked) throw new BackfillBusyError(opts.lock)

      const cursor = (await kvGet<{ id: string }>(opts.keys.cursor, { executor: tx }))?.id ?? null
      const range = (await tx.execute(sql`
        SELECT ((array_agg(id ORDER BY id DESC))[1])::text AS to_id, count(*)::int AS n FROM (
          SELECT id FROM ${table}
          WHERE ${cursor === null ? sql`true` : sql`id > ${cursor}::uuid`}
          ORDER BY id
          LIMIT ${batchSize}
        ) batch
      `)) as unknown as Array<{ to_id: string | null; n: number }>
      const { to_id: toId, n } = range[0] ?? { to_id: null, n: 0 }

      if (toId !== null && n > 0) {
        await opts.walk.step(tx, { fromId: cursor, toId })
        await kvSet(opts.keys.cursor, { id: toId }, DURABLE_KV_TTL_SECONDS, { executor: tx })
      }
      if (n < batchSize) {
        await kvSet(opts.keys.done, { at: new Date().toISOString() }, DURABLE_KV_TTL_SECONDS, {
          executor: tx,
        })
        await opts.onFinish?.(tx)
        return true
      }
      return false
    })
    batches += 1
    if (finished) break
    if (opts.walk.pauseMs) await new Promise((resolve) => setTimeout(resolve, opts.walk.pauseMs))
  }
  log.info({ event: 'backfill.walked', backfill: opts.label, batches }, 'backfill walk finished')
}

/** Walk a backfill to its end. Throws on a missing migration, a held lock or a failed batch. */
export async function walkBackfill(entry: BatchedBackfill): Promise<void> {
  if (!(await migrationApplied(entry.requiresMigration))) {
    throw new BackfillMigrationMissingError(entry.name, entry.requiresMigration)
  }
  const followUp = entry.followUp
  await walk({
    label: entry.name,
    lock: `quackback:backfill:${entry.name}`,
    keys: backfillKeys(entry.name),
    walk: entry,
    onFinish: followUp
      ? async (tx) => {
          const gen = (await kvGet<number>(followUpKeys(entry.name).gen, { executor: tx })) ?? 1
          await enqueueJob({
            queue: followUp.queue,
            dedupeKey: dedupeKeyFor(followUp.queue, entry.name, gen),
            payload: { name: entry.name, gen },
            maxAttempts: maxAttemptsOf(followUp.queue),
            runAt: new Date(Date.now() + followUp.delayMs),
            executor: tx,
          })
        }
      : undefined,
  })
}

/** Walk a backfill's follow-up to its end. */
export async function walkFollowUp(entry: BatchedBackfill): Promise<void> {
  const followUp = entry.followUp
  if (!followUp) throw new Error(`no follow-up step is registered for backfill ${entry.name}`)
  const tag = followUp.requiresMigration ?? entry.requiresMigration
  if (!(await migrationApplied(tag))) {
    throw new BackfillMigrationMissingError(`${entry.name} follow-up`, tag)
  }
  await walk({
    label: `${entry.name} follow-up`,
    lock: `quackback:backfill:${entry.name}:follow-up`,
    keys: followUpKeys(entry.name),
    walk: followUp,
  })
}

/** True when every registered backfill and follow-up has its done marker. */
export async function backfillWorkDone(): Promise<boolean> {
  for (const entry of registeredBackfills()) {
    if (!(await isDone(backfillKeys(entry.name).done))) return false
    if (entry.followUp && !(await isDone(followUpKeys(entry.name).done))) return false
  }
  return true
}

/**
 * Workspaces this process has seen with every backfill done, keyed by the
 * registry they were checked against. Done markers do not come back unset, so
 * the gate stops reading kv once a workspace is done.
 */
const backfillsDoneSeen = new WorkspaceKeyedCache<true>(10_000)

function registryKey(): string {
  return registeredBackfills()
    .map((b) => `${b.name}${b.followUp ? '+' : ''}`)
    .join(',')
}

/**
 * The `startup-backfill` schedule gate: open while any registered backfill or
 * follow-up is not done. Shut, with no query, when nothing is registered.
 */
export async function startupBackfillDue(): Promise<boolean> {
  if (registeredBackfills().length === 0) return false
  const key = registryKey()
  if (backfillsDoneSeen.get(key)) return false
  const done = await backfillWorkDone()
  if (done) backfillsDoneSeen.set(key, true)
  return !done
}
