/**
 * Schema versions, and the compatibility floor a pooled fleet gates on.
 *
 * Under pooled compute one code version serves tenants on two schema versions
 * for the duration of every rollout. Expand-only is
 * necessary but **not sufficient**, and the reason is specific: Drizzle emits
 * explicit column lists, so a build that postdates an additive migration issues
 * `select "id", …, "cloud", … from "settings"` and `findFirst()` *throws* on a
 * database where that column does not exist yet. A missing value and a missing
 * column are not the same thing.
 *
 * So the rule is an ordering rule: additive change must be applied **before**
 * the code that reads it. `MIN_SCHEMA_VERSION` is where a build states the
 * oldest schema it tolerates, and the tenant middleware refuses a tenant below
 * it — 503 for that tenant only, never for the fleet.
 *
 * ## Why the floor is a prefix check and not a high-water mark
 *
 * A ledger is a *set*, not a counter, and this fleet has proved it: five live
 * gauntlet tenant databases have every one of their 226 ledger rows and are
 * physically carrying migrations 0251/0252/0253 that no row records, because
 * they were applied with `psql -f`. A high-water comparison
 * (`max(created_at) >= floor`) would read a database with a gap as satisfied.
 *
 * {@link evaluateSchemaFloor} therefore asks the only question that is
 * actually load-bearing: *is every bundled migration at or below the floor
 * present in this database's ledger?* Extra rows above the floor are ignored,
 * which is deliberate and is the second half of keeping
 * `getMigrationStatus()`'s semantics: **a tenant ahead of the code must keep
 * being served by the code it is ahead of**, because that is precisely what
 * happens to every not-yet-restarted replica during a rollout.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import journal from '../drizzle/meta/_journal.json'

/**
 * Absolute path to the bundled SQL, resolved from this module rather than from
 * a caller's cwd.
 *
 * The replay-safety preflight has to read the same files drizzle will execute.
 * A caller-relative path would give a different answer depending on where the
 * process was started, and "the plan disagreed with the run" is the one thing a
 * preflight must not do.
 */
export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../drizzle'
)

export interface BundledMigration {
  /** Journal `when` millis. The migrator stamps this into the ledger row. */
  when: number
  /** File tag, e.g. `0251_pg_kv_presence_realtime`. */
  tag: string
}

/** Every migration bundled into this build, in journal order. */
export const BUNDLED_MIGRATIONS: readonly BundledMigration[] = (
  journal as { entries: BundledMigration[] }
).entries.map((e) => ({ when: e.when, tag: e.tag }))

/** The newest migration this build ships. What a reconciler drives tenants toward. */
export function latestBundledVersion(): number {
  return BUNDLED_MIGRATIONS.reduce((max, e) => (e.when > max ? e.when : max), 0)
}

export class UnknownSchemaVersion extends Error {
  /**
   * Carried so the refusal path can tell "this process is misconfigured" from
   * "this database failed its identity check". Without it the error funnels
   * into the generic `pool_unavailable` bucket and gets reported as a
   * fingerprint refusal — the cross-tenant alarm — while the real fault is a
   * typo in an environment variable.
   */
  readonly code = 'schema_floor_misconfigured'
  constructor(spec: string) {
    super(
      `MIN_SCHEMA_VERSION=${spec} names no bundled migration. Use a full tag ` +
        `(0250_job_queue), its numeric prefix (0250), or a journal ` +
        `millis value. Refusing rather than guessing: a floor that silently resolves ` +
        'to nothing is a gate that is switched off while looking switched on.'
    )
    this.name = 'UnknownSchemaVersion'
  }
}

/**
 * Turn a human-written floor into a journal `when`.
 *
 * Accepts a full tag, its four-digit prefix, or the raw millis. Anything else
 * throws — a typo'd `MIN_SCHEMA_VERSION` must not degrade into "no floor",
 * because that is the failure that looks exactly like success.
 */
export function resolveVersionSpec(spec: string): number {
  const trimmed = spec.trim()
  if (trimmed === '') throw new UnknownSchemaVersion(spec)

  const byTag = BUNDLED_MIGRATIONS.find((e) => e.tag === trimmed)
  if (byTag) return byTag.when

  if (/^\d{4}$/.test(trimmed)) {
    const byPrefix = BUNDLED_MIGRATIONS.filter((e) => e.tag.startsWith(`${trimmed}_`))
    if (byPrefix.length === 1) return byPrefix[0]!.when
    throw new UnknownSchemaVersion(spec)
  }

  if (/^\d+$/.test(trimmed)) {
    const millis = Number(trimmed)
    if (BUNDLED_MIGRATIONS.some((e) => e.when === millis)) return millis
    throw new UnknownSchemaVersion(spec)
  }

  throw new UnknownSchemaVersion(spec)
}

/** Tag for a journal `when`, for log lines and refusal messages. */
export function tagForVersion(when: number): string {
  return BUNDLED_MIGRATIONS.find((e) => e.when === when)?.tag ?? String(when)
}

/** Anything that can run a raw statement — a drizzle Database or a postgres.Sql. */
export interface LedgerReader {
  execute?: (query: unknown) => Promise<unknown>
  unsafe?: (query: string) => Promise<unknown>
}

export interface AppliedLedger {
  /** Journal `when` values present in `drizzle.__drizzle_migrations`. */
  versions: Set<number>
  /** Row count. Diagnostic: it reads plausible while a database is wrong. */
  count: number
  /** Largest applied `when`, or 0 on an empty ledger. */
  max: number
}

function rowsOf(result: unknown): { created_at: string | number }[] {
  if (Array.isArray(result)) return result as { created_at: string | number }[]
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: { created_at: string | number }[] }).rows
  }
  return []
}

/**
 * Read a tenant database's applied ledger.
 *
 * A database with no `drizzle` schema at all — a genuinely fresh one — reports
 * an empty ledger rather than throwing, because "never migrated" is a state the
 * reconciler has to be able to act on, not an error it has to catch.
 */
export async function readAppliedLedger(reader: LedgerReader): Promise<AppliedLedger> {
  const statement = `SELECT created_at FROM drizzle.__drizzle_migrations`
  let result: unknown
  try {
    result = reader.execute
      ? await reader.execute(sql.raw(statement))
      : await reader.unsafe!(statement)
  } catch (err) {
    // 42P01 undefined_table / 3F000 invalid_schema_name — never migrated.
    const code = (err as { code?: string } | null)?.code
    if (code === '42P01' || code === '3F000') return { versions: new Set(), count: 0, max: 0 }
    throw err
  }
  const rows = rowsOf(result)
  const versions = new Set(rows.map((r) => Number(r.created_at)))
  return {
    versions,
    count: rows.length,
    max: rows.length === 0 ? 0 : Math.max(...versions),
  }
}

/**
 * Delete every ledger row at or above `from`, and report what was deleted.
 *
 * The **only** write this codebase performs against `drizzle.__drizzle_migrations`,
 * and it is a DELETE by construction. That matters more than it looks:
 *
 * - A DELETE can only ever make the ledger claim *less*. The rows that remain
 *   were each written by drizzle after it executed their statements, so they are
 *   still evidence; the ones removed are claims withdrawn, never claims invented.
 *   There is no code path anywhere that inserts a row here — drizzle writes them,
 *   after the fact, as a consequence of having run.
 * - Under-claiming is the recoverable direction. A ledger that describes less
 *   than the database is replayed forward by the next run; a ledger that
 *   describes more is a false answer nothing can detect.
 *
 * Callers must have established that everything the truncation puts back inside
 * drizzle's replay window is safe to replay. This function does not check that
 * and cannot: it can see the ledger, not the SQL.
 */
export async function truncateAppliedLedger(reader: LedgerReader, from: number): Promise<number[]> {
  if (!Number.isSafeInteger(from)) {
    throw new Error(`truncateAppliedLedger needs an integer journal timestamp, got ${from}`)
  }
  const statement = `DELETE FROM drizzle.__drizzle_migrations WHERE created_at >= ${from} RETURNING created_at`
  const result = reader.execute
    ? await reader.execute(sql.raw(statement))
    : await reader.unsafe!(statement)
  return rowsOf(result)
    .map((r) => Number(r.created_at))
    .sort((a, b) => a - b)
}

export interface SchemaFloorVerdict {
  ok: boolean
  /** Bundled tags at or below the floor that this database's ledger does not record. */
  missing: string[]
  floorTag: string
}

/**
 * Is this database at or above the compatibility floor?
 *
 * The check is over the *prefix* of the bundled journal up to and including the
 * floor. Migrations above the floor are not consulted at all, so a tenant that
 * a newer image has already migrated past this build reads as satisfied — the
 * "serve a tenant ahead of the code normally" half of the gate, and the reason
 * `getMigrationStatus()`'s bundled-⊆-applied semantics are kept rather than
 * "fixed".
 */
export function evaluateSchemaFloor(applied: AppliedLedger, floor: number): SchemaFloorVerdict {
  const required = BUNDLED_MIGRATIONS.filter((e) => e.when <= floor)
  const missing = required.filter((e) => !applied.versions.has(e.when)).map((e) => e.tag)
  return { ok: missing.length === 0, missing, floorTag: tagForVersion(floor) }
}
