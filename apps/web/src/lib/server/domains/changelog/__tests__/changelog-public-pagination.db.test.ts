/**
 * Real-DB coverage for the public changelog list: "load more" pages must walk
 * every published entry in display order, whether an entry's date comes from
 * `display_date` or `published_at`.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type ChangelogId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { changelogEntries, eq } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { listPublicChangelogs } from '../changelog.public'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: changelogEntries.id, displayDate: changelogEntries.displayDate })
      .from(changelogEntries)
      .limit(0)
  },
})

const BASE = Date.parse('2026-01-01T00:00:00Z')
const minutes = (n: number) => new Date(BASE + n * 60_000)

async function insertPublished(publishedAt: Date, displayDate: Date | null = null) {
  const id = createId('changelog') as ChangelogId
  await testDb
    .insert(changelogEntries)
    .values({ id, title: 'Entry', content: 'body', publishedAt, displayDate })
  return id
}

async function walk(limit: number): Promise<ChangelogId[]> {
  const seen: ChangelogId[] = []
  let cursor: string | undefined
  for (let guard = 0; guard < 20; guard++) {
    const page = await listPublicChangelogs({ cursor, limit })
    seen.push(...page.items.map((e) => e.id as ChangelogId))
    if (!page.hasMore || !page.nextCursor) break
    cursor = page.nextCursor
  }
  return seen
}

describe.skipIf(!fixture.available)(
  'listPublicChangelogs pagination (real DB, rolled back)',
  () => {
    beforeEach(fixture.begin)
    afterEach(fixture.rollback)
    afterAll(fixture.close)

    it('walks every entry newest first across pages', async () => {
      const ids: ChangelogId[] = []
      for (let i = 0; i < 12; i++) ids.push(await insertPublished(minutes(i)))
      expect(await walk(5)).toEqual([...ids].reverse())
    })

    it('orders by display date when one is set and pages past it', async () => {
      // Published last, but dated before everything else.
      const backdated = await insertPublished(minutes(100), minutes(-10))
      const ids: ChangelogId[] = []
      for (let i = 0; i < 4; i++) ids.push(await insertPublished(minutes(i)))
      expect(await walk(2)).toEqual([...[...ids].reverse(), backdated])
    })

    it('keeps paging when the cursor entry was soft-deleted', async () => {
      const ids: ChangelogId[] = []
      for (let i = 0; i < 5; i++) ids.push(await insertPublished(minutes(i)))
      const first = await listPublicChangelogs({ limit: 2 })
      expect(first.nextCursor).toBe(ids[3])
      await testDb
        .update(changelogEntries)
        .set({ deletedAt: new Date() })
        .where(eq(changelogEntries.id, ids[3]))

      const second = await listPublicChangelogs({ cursor: first.nextCursor!, limit: 2 })
      expect(second.items.map((e) => e.id)).toEqual([ids[2], ids[1]])
    })

    it('does not skip or repeat entries that share a display date', async () => {
      const ids: ChangelogId[] = []
      for (let i = 0; i < 4; i++) ids.push(await insertPublished(minutes(i), minutes(50)))
      const seen = await walk(1)
      expect(seen).toHaveLength(4)
      expect([...seen].sort()).toEqual([...ids].sort())
    })
  }
)
