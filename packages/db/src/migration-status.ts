/**
 * Migration ledger status: compares the bundled drizzle journal (the
 * migrations shipped with this build) against the rows the migrator has
 * recorded in drizzle.__drizzle_migrations. The migrator stamps each row's
 * created_at with the journal entry's `when` millis, so every bundled entry
 * can be checked exactly instead of trusting a high-water count.
 */
import { sql } from 'drizzle-orm'
import type { Database } from './client'
import journal from '../drizzle/meta/_journal.json'

export interface MigrationStatus {
  /** Every bundled migration is present in the applied ledger. */
  upToDate: boolean
  bundledCount: number
  appliedCount: number
}

interface JournalEntry {
  when: number
  tag: string
}

const entries = (journal as { entries: JournalEntry[] }).entries
export async function getMigrationStatus(db: Database): Promise<MigrationStatus> {
  const result = await db.execute(sql`SELECT created_at FROM drizzle.__drizzle_migrations`)
  const rows = Array.from(result as Iterable<{ created_at: string | number }>)
  const applied = new Set(rows.map((row) => Number(row.created_at)))

  return {
    upToDate: entries.every((entry) => applied.has(entry.when)),
    bundledCount: entries.length,
    appliedCount: rows.length,
  }
}
