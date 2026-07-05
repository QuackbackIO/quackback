import { sql, type SQL, type AnyColumn } from 'drizzle-orm'
import { toUuid } from '@quackback/ids'

/**
 * CASE expression for batch position reorders: each id's array index becomes
 * its new position in one UPDATE (`.set({ position: positionCaseSql(t.id, ids) })`).
 * Positions are inlined (sql.raw) because the driver can bind integers as
 * text, which then mismatches the integer column inside a CASE. Shared by
 * every drag-reorder service so the gotcha lives in one place.
 */
export function positionCaseSql(idColumn: AnyColumn, orderedIds: readonly string[]): SQL {
  const cases = orderedIds
    .map((id, i) => sql`WHEN ${idColumn} = ${toUuid(id)} THEN ${sql.raw(String(i))}`)
    .reduce((acc, curr) => sql`${acc} ${curr}`, sql``)
  return sql`CASE ${cases} END`
}
