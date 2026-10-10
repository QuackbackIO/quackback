import { sql, type SQL, type AnyColumn } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { db } from '@/lib/server/db'

/**
 * Next append-at-end position: one past the current max, or `0` when the
 * table (optionally filtered) is empty. Shared by every create-and-append
 * path so the `coalesce(max, -1)` empty-table gotcha lives in one place.
 */
export async function nextPosition(
  table: PgTable,
  column: AnyColumn,
  where?: SQL
): Promise<number> {
  const query = db.select({ max: sql<number>`coalesce(max(${column}), -1)` }).from(table)
  const [row] = where ? await query.where(where) : await query
  return Number(row?.max ?? -1) + 1
}
