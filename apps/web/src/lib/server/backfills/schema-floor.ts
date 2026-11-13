/**
 * Has this workspace applied a given migration?
 *
 * A Cloud worker can roll to a new build before every workspace has migrated to
 * it, and a workspace that is migrated on its next request may sleep through
 * the deploy. So a job or backfill that needs a migration checks the
 * workspace's own ledger: the schedule pass does not enqueue it before the
 * migration, and a job that still meets a missing migration throws, so the
 * queue retries it later rather than failing it for good.
 *
 * `MIN_SCHEMA_VERSION` is not this. It is the Cloud web tier's floor, a deploy
 * setting the fleet sets per roll; no change to the code moves it.
 */
import { db } from '@/lib/server/db'
import {
  BUNDLED_MIGRATIONS,
  readAppliedLedger,
  type LedgerReader,
} from '@quackback/db/schema-version'

/** True when the ledger records the bundled migration `tag` (`0311_name`). */
export async function migrationApplied(
  tag: string,
  reader: LedgerReader = db as unknown as LedgerReader
): Promise<boolean> {
  const migration = BUNDLED_MIGRATIONS.find((m) => m.tag === tag)
  if (!migration) throw new Error(`"${tag}" is not a migration this build bundles`)
  const ledger = await readAppliedLedger(reader)
  return ledger.versions.has(migration.when)
}
