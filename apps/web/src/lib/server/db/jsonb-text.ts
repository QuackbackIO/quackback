/**
 * Atomic merge into a text-typed JSON column (`user.metadata`), in SQL rather
 * than a JS read/merge/write so a concurrent writer landing between a load and
 * the update can never be clobbered. Shared by the widget identify route and
 * the portal-user identify/update service.
 *
 * Removed keys go in as `ARRAY[$1, $2]::text[]`, never as an interpolated JS
 * array: drizzle expands an array param into a parenthesised list, so
 * `${keys}::text[]` renders `()::text[]` for no keys and `($1, $2)::text[]`
 * otherwise, and Postgres rejects both. `ARRAY[]::text[]` is a valid empty
 * array, so callers don't need to special-case "nothing to remove".
 */
import { sql, type AnyColumn, type SQL } from 'drizzle-orm'

export function mergeJsonbText(
  column: AnyColumn,
  updates: Record<string, unknown>,
  removals: readonly string[] = []
): SQL {
  const keys = sql.join(
    removals.map((key) => sql`${key}`),
    sql`, `
  )
  return sql`((coalesce(nullif(${column}, ''), '{}')::jsonb - ARRAY[${keys}]::text[]) || ${JSON.stringify(updates)}::jsonb)::text`
}
