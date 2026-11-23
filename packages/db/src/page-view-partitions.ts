/**
 * Day-partition maintenance for the page_views table.
 *
 * The table is declaratively range-partitioned by occurred_at. A daily job
 * calls ensurePageViewPartitions (pre-create a window ahead) and
 * dropExpiredPageViewPartitions (instant, bloat-free retention: dropping a
 * whole day partition replaces a mass DELETE). All date arithmetic runs on
 * the database clock (current_date), the same source the 0137 migration
 * used, so partition bounds stay aligned regardless of app-host timezones.
 *
 * The window is a forecast, not a guarantee: a workspace whose maintenance did
 * not run for longer than the window has no partition for today. insertPageView
 * covers that at the point of use by creating the missing day and retrying.
 */
import { sql } from 'drizzle-orm'
import type { Database } from './client'
import { pageViews } from './schema/visitor-analytics'

const PARTITION_NAME = /^page_views_(\d{8})$/

/**
 * Serialises partition creation on one database. `CREATE TABLE IF NOT EXISTS`
 * alone is not race-safe: two sessions can both see the name free, and the
 * loser fails on the catalog's unique index instead of skipping. Taken inside
 * each DO block, so it is a transaction lock released when the block ends.
 */
const PARTITION_LOCK = `PERFORM pg_advisory_xact_lock(hashtext('page_views partition ddl'));`

/** The one DDL statement every partition goes through, for the day held in `d`. */
const CREATE_DAY_PARTITION = `EXECUTE format(
			'CREATE TABLE IF NOT EXISTS %I PARTITION OF "page_views" FOR VALUES FROM (%L) TO (%L)',
			'page_views_' || to_char(d, 'YYYYMMDD'),
			d,
			d + 1
		);`

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/** Create day partitions from yesterday through `daysAhead` days out. Idempotent. */
export async function ensurePageViewPartitions(
  db: Database,
  opts?: { daysAhead?: number }
): Promise<void> {
  const daysAhead = clampInt(opts?.daysAhead ?? 7, 1, 60)
  await db.execute(
    sql.raw(`DO $$
DECLARE
	d date;
BEGIN
	${PARTITION_LOCK}
	FOR i IN -1..${daysAhead} LOOP
		d := current_date + i;
		${CREATE_DAY_PARTITION}
	END LOOP;
END $$;`)
  )
}

/**
 * Create the day partition that holds `occurredAt` (default: now, on the
 * database clock). Idempotent and safe to call from many sessions at once.
 *
 * The day is derived in SQL with the same cast the window above uses, so the
 * bounds always line up with partitions created there.
 */
export async function ensurePageViewPartitionFor(db: Database, occurredAt?: Date): Promise<void> {
  const day =
    occurredAt === undefined ? 'current_date' : `('${occurredAt.toISOString()}'::timestamptz)::date`
  await db.execute(
    sql.raw(`DO $$
DECLARE
	d date := ${day};
BEGIN
	${PARTITION_LOCK}
	${CREATE_DAY_PARTITION}
END $$;`)
  )
}

const MISSING_PARTITION = 'no partition of relation "page_views" found for row'

/**
 * Did this insert fail because no page_views partition covers the row's day?
 * Postgres reports it as a check_violation (23514); the driver error may sit
 * under the query builder's wrapper as `cause`.
 */
export function isMissingPageViewPartitionError(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current instanceof Object; depth++) {
    const { code, message } = current as { code?: unknown; message?: unknown }
    if (code === '23514' && typeof message === 'string' && message.includes(MISSING_PARTITION)) {
      return true
    }
    current = (current as { cause?: unknown }).cause
  }
  return false
}

/**
 * Store one page view. When no partition covers its day yet (the daily window
 * ran out), create that partition and insert again, once. The common path is
 * the single INSERT and nothing else.
 */
export async function insertPageView(
  db: Database,
  values: typeof pageViews.$inferInsert
): Promise<void> {
  try {
    await db.insert(pageViews).values(values)
  } catch (error) {
    if (!isMissingPageViewPartitionError(error)) throw error
    await ensurePageViewPartitionFor(db, values.occurredAt)
    await db.insert(pageViews).values(values)
  }
}

/**
 * Drop day partitions older than the retention window. Returns the dropped
 * partition names. Rollup tables are unaffected — they carry no identifiers
 * and are kept indefinitely.
 */
export async function dropExpiredPageViewPartitions(
  db: Database,
  opts?: { retentionDays?: number }
): Promise<string[]> {
  const retentionDays = clampInt(opts?.retentionDays ?? 90, 1, 3650)

  const cutoffResult = await db.execute(
    sql`SELECT to_char(current_date - ${retentionDays}::int, 'YYYYMMDD') AS cutoff`
  )
  const [{ cutoff }] = Array.from(cutoffResult as Iterable<{ cutoff: string }>)

  const partitionsResult = await db.execute(
    sql`SELECT c.relname AS relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid WHERE i.inhparent = 'page_views'::regclass`
  )
  const partitions = Array.from(partitionsResult as Iterable<{ relname: string }>)

  const dropped: string[] = []
  for (const { relname } of partitions) {
    const match = PARTITION_NAME.exec(relname)
    if (!match || match[1] >= cutoff) continue
    await db.execute(sql.raw(`DROP TABLE IF EXISTS "${relname}"`))
    dropped.push(relname)
  }
  return dropped
}
