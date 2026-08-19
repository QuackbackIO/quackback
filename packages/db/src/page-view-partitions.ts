/**
 * Day-partition maintenance for the page_views table.
 *
 * The table is declaratively range-partitioned by occurred_at. A daily job
 * calls ensurePageViewPartitions (pre-create a window ahead) and
 * dropExpiredPageViewPartitions (instant, bloat-free retention: dropping a
 * whole day partition replaces a mass DELETE). All date arithmetic runs on
 * the database clock (current_date), the same source the 0137 migration
 * used, so partition bounds stay aligned regardless of app-host timezones.
 */
import { sql } from 'drizzle-orm'
import type { Database } from './client'

const PARTITION_NAME = /^page_views_(\d{8})$/

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
	FOR i IN -1..${daysAhead} LOOP
		d := current_date + i;
		EXECUTE format(
			'CREATE TABLE IF NOT EXISTS %I PARTITION OF "page_views" FOR VALUES FROM (%L) TO (%L)',
			'page_views_' || to_char(d, 'YYYYMMDD'),
			d,
			d + 1
		);
	END LOOP;
END $$;`)
  )
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
