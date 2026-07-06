/**
 * Generic composite ("seek"/keyset) pagination condition builder, shared by
 * the conversation inbox sort (`conversation.query.ts`) and the ticket list
 * sort (`ticket.service.ts`). Both hand-nest the same "row strictly after the
 * cursor, lexicographically" shape per sort — `strict(col0) OR (equal(col0)
 * AND strict(col1)) OR ...` — which is easy to get subtly wrong past two
 * columns (a missing AND-prefix silently dupes or skips rows across a page
 * boundary). This module centralizes that assembly so it's written, and
 * unit-tested, once.
 *
 * Building the per-column `equal`/`strict` SQL fragments stays at the call
 * site (a plain column, a NULLS-LAST column, or a derived expression like a
 * priority-rank CASE all need their own eq/gt/lt shape) — see `ascColumn` /
 * `descColumn` for the common case, which covers every non-NULLS-LAST column
 * both domains use.
 */
import { and, eq, gt, lt, or, sql, type AnyColumn, type SQL } from 'drizzle-orm'

/**
 * One column's contribution to the composite condition, already reduced to
 * its two SQL fragments:
 *  - `equal`: this column matches the cursor row exactly (the AND-prefix for
 *    every lower-priority column).
 *  - `strict`: this column is strictly "further along" the sort than the
 *    cursor row, in that column's own direction/null-handling. `undefined`
 *    when no row can be "further along" than the cursor's own value at this
 *    column — the only case is a NULLS-LAST column whose cursor value is
 *    itself null (nothing sorts past the tail; the divergence, if any, can
 *    only come from a later column).
 */
export interface KeysetColumn {
  equal: SQL
  strict: SQL | undefined
}

/**
 * The composite "row strictly after the cursor" condition for an ordered list
 * of keyset columns (most significant first — the same order as the ORDER BY
 * list it backs): `strict(0) OR (equal(0) AND strict(1)) OR (equal(0) AND
 * equal(1) AND strict(2)) OR ...`. A column whose `strict` is `undefined`
 * contributes no clause at its own position (it can never be the divergence
 * point) but still supplies `equal` for any column after it.
 *
 * Every real call site ends its column list with a plain id tiebreak (whose
 * `strict` is always defined), so the result always has at least one clause.
 */
export function buildKeysetCondition(columns: readonly KeysetColumn[]): SQL {
  const clauses: SQL[] = []
  for (let i = 0; i < columns.length; i++) {
    const strict = columns[i].strict
    if (!strict) continue
    const prefix = columns.slice(0, i).map((c) => c.equal)
    clauses.push(prefix.length > 0 ? (and(...prefix, strict) as SQL) : strict)
  }
  return clauses.length > 0 ? (or(...clauses) as SQL) : sql`false`
}

/** A plain ascending column with no NULLS-LAST handling (e.g. `createdAt`,
 *  `id`, ...) — the common case for both domains' id tiebreaks and simple
 *  timestamp sorts. */
export function ascColumn<T>(column: AnyColumn, cursorValue: T): KeysetColumn {
  return { equal: eq(column, cursorValue), strict: gt(column, cursorValue) }
}

/** A plain descending column with no NULLS-LAST handling. */
export function descColumn<T>(column: AnyColumn, cursorValue: T): KeysetColumn {
  return { equal: eq(column, cursorValue), strict: lt(column, cursorValue) }
}
