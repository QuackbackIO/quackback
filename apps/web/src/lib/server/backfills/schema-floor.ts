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
import { migrationAppliedIn } from '@/lib/server/fleet/schema-floor'

/** True when this workspace's ledger records the bundled migration `tag`. */
export function migrationApplied(tag: string): Promise<boolean> {
  return migrationAppliedIn(db as unknown as Parameters<typeof migrationAppliedIn>[0], tag)
}
