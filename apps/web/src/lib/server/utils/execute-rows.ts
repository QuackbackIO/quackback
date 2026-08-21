/**
 * Safely extract rows from db.execute() result.
 * Handles both postgres-js (array directly) and some HTTP drivers that return `{ rows }`.
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
