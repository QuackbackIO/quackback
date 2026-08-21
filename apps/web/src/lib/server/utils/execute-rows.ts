/**
 * Safely extract rows from db.execute() result.
 * Handles both postgres-js (array directly) and neon-http ({ rows: [...] }) formats.
 */
export function getExecuteRows<T>(result: unknown): T[] {
  if (
    result &&
    typeof result === 'object' &&
    'rows' in result &&
    Array.isArray((result as { rows: unknown }).rows)
  ) {
    return (result as { rows: T[] }).rows
  }
  if (Array.isArray(result)) {
    return result as T[]
  }
  return []
}

/**
 * Affected-row count from db.execute() result, for statements with no RETURNING.
 * postgres-js exposes it as `count` on the result array; drivers that return a
 * result object carry `rowCount`. Falls back to counting returned rows.
 */
export function getExecuteCount(result: unknown): number {
  if (result && typeof result === 'object') {
    const r = result as { count?: unknown; rowCount?: unknown }
    if (typeof r.count === 'number') return r.count
    if (typeof r.rowCount === 'number') return r.rowCount
  }
  return getExecuteRows(result).length
}
