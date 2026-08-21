/**
 * True when `err` carries the given Postgres SQLSTATE. Drizzle wraps the
 * driver error and exposes the pg fields on `cause`, so both the bare driver
 * error and a wrapped one resolve true.
 */
export function hasPgErrorCode(err: unknown, code: string): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null | undefined
  return e?.code === code || e?.cause?.code === code
}

/** Predicate for a Postgres unique-violation (SQLSTATE 23505). */
export function isUniqueViolation(err: unknown): boolean {
  return hasPgErrorCode(err, '23505')
}
