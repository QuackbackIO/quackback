/**
 * Predicate for a Postgres unique-violation (SQLSTATE 23505). Drizzle wraps the
 * driver error and exposes the pg fields on `cause`, so both the bare driver
 * error and a wrapped one resolve true.
 */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null | undefined
  return e?.code === '23505' || e?.cause?.code === '23505'
}
