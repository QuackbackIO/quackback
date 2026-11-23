/**
 * CHG-A-49: renaming a label keeps its id, and a rename onto a taken name is
 * refused. Real DB, because the bug was a TypeID reaching a uuid column
 * through raw SQL, which only Postgres catches.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createDbTestFixture } from '@/lib/server/__tests__/db-test-fixture'
import { changelogCategories } from '@/lib/server/db'
import { createChangelogCategory, updateChangelogCategory } from '../changelog-category.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: changelogCategories.id }).from(changelogCategories).limit(0)
  },
})

const suffix = () => Math.random().toString(36).slice(2, 8)

describe.skipIf(!fixture.available)('changelog label rename (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('CHG-A-49 renaming a label keeps its id', async () => {
    const label = await createChangelogCategory({ name: `Fixes ${suffix()}`, color: '#123456' })

    const renamed = await updateChangelogCategory(label.id, { name: `Bug fixes ${suffix()}` })

    expect(renamed.id).toBe(label.id)
    expect(renamed.name).toMatch(/^Bug fixes /)
  })

  it('CHG-A-49 renaming a label to its own name in another case is allowed', async () => {
    const name = `Features ${suffix()}`
    const label = await createChangelogCategory({ name, color: '#123456' })

    const renamed = await updateChangelogCategory(label.id, { name: name.toUpperCase() })

    expect(renamed.name).toBe(name.toUpperCase())
  })

  it('CHG-A-49 a rename onto a taken name is refused', async () => {
    const taken = `Security ${suffix()}`
    await createChangelogCategory({ name: taken, color: '#123456' })
    const label = await createChangelogCategory({ name: `Other ${suffix()}`, color: '#123456' })

    await expect(
      updateChangelogCategory(label.id, { name: taken.toLowerCase() })
    ).rejects.toMatchObject({ code: 'DUPLICATE_NAME' })
  })
})
