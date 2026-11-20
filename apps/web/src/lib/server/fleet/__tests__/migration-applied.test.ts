/**
 * `migrationAppliedIn` answers from the ledger it is given, by journal tag.
 */
import { describe, expect, it } from 'vitest'
import { BUNDLED_MIGRATIONS } from '@quackback/db/schema-version'
import { migrationAppliedIn } from '../schema-floor'

/** A ledger reader holding exactly these journal timestamps. */
function ledger(versions: number[]) {
  return { unsafe: async () => versions.map((v) => ({ created_at: String(v) })) }
}

describe('migrationAppliedIn', () => {
  const newest = BUNDLED_MIGRATIONS[BUNDLED_MIGRATIONS.length - 1]
  const older = BUNDLED_MIGRATIONS[BUNDLED_MIGRATIONS.length - 2]

  it('is true when the ledger records the tag and false when it does not', async () => {
    expect(await migrationAppliedIn(ledger([older.when, newest.when]), newest.tag)).toBe(true)
    expect(await migrationAppliedIn(ledger([older.when]), newest.tag)).toBe(false)
  })

  it('refuses a tag this build does not bundle', async () => {
    await expect(migrationAppliedIn(ledger([]), '9999_no_such_migration')).rejects.toThrow(
      /not a migration this build bundles/
    )
  })
})
