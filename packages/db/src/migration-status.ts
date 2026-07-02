/**
 * Migration ledger status: compares the bundled drizzle journal (the
 * migrations shipped with this build) against the rows the migrator has
 * recorded in drizzle.__drizzle_migrations. The migrator stamps each row's
 * created_at with the journal entry's `when` millis, so the applied
 * high-water mark is directly comparable to the bundled ledger.
 */
import { sql } from 'drizzle-orm'
import type { Database } from './client'
import journal from '../drizzle/meta/_journal.json'

export interface MigrationStatus {
  /** The applied high-water mark is at or past the bundled ledger's last entry. */
  upToDate: boolean
  bundledCount: number
  appliedCount: number
}

interface JournalEntry {
  when: number
  tag: string
}

const entries = (journal as { entries: JournalEntry[] }).entries
const latestBundled = entries.length > 0 ? Math.max(...entries.map((e) => e.when)) : 0

export async function getMigrationStatus(db: Database): Promise<MigrationStatus> {
  const result = await db.execute(
    sql`SELECT count(*)::int AS count, coalesce(max(created_at), 0) AS latest FROM drizzle.__drizzle_migrations`
  )
  const [row] = Array.from(result as Iterable<{ count: number; latest: string | number }>)

  return {
    upToDate: Number(row?.latest ?? 0) >= latestBundled,
    bundledCount: entries.length,
    appliedCount: Number(row?.count ?? 0),
  }
}
