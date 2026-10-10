/**
 * Real-DB coverage for the admin changelog list order: keyset pages must walk
 * the whole list in the requested direction, not reorder one loaded page.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type ChangelogId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { changelogEntries } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { listChangelogs } from '../changelog.query'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: changelogEntries.id, created: changelogEntries.createdAt })
      .from(changelogEntries)
      .limit(0)
  },
})

/** Seeds entries created one minute apart, oldest first; two share a timestamp. */
async function seed(count: number): Promise<ChangelogId[]> {
  const base = Date.parse('2026-01-01T00:00:00Z')
  const ids: ChangelogId[] = []
  for (let i = 0; i < count; i++) {
    const id = createId('changelog') as ChangelogId
    ids.push(id)
    await testDb.insert(changelogEntries).values({
      id,
      title: `Entry ${i}`,
      content: 'body',
      createdAt: new Date(base + i * 60_000),
    })
  }
  return ids
}

async function walk(sort: 'newest' | 'oldest', limit: number): Promise<ChangelogId[]> {
  const seen: ChangelogId[] = []
  let cursor: string | undefined
  for (let guard = 0; guard < 20; guard++) {
    const page = await listChangelogs({ sort, cursor, limit })
    seen.push(...page.items.map((e) => e.id))
    if (!page.hasMore || !page.nextCursor) break
    cursor = page.nextCursor
  }
  return seen
}

describe.skipIf(!fixture.available)('listChangelogs sort (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('walks newest first across page boundaries by default', async () => {
    const ids = await seed(5)
    expect(await walk('newest', 2)).toEqual([...ids].reverse())
    const first = await listChangelogs({ limit: 2 })
    expect(first.items.map((e) => e.id)).toEqual([ids[4], ids[3]])
  })

  it('walks oldest first across page boundaries', async () => {
    const ids = await seed(5)
    expect(await walk('oldest', 2)).toEqual(ids)
  })

  it('returns the oldest entries on the first page for oldest', async () => {
    const ids = await seed(25)
    const first = await listChangelogs({ sort: 'oldest', limit: 20 })
    expect(first.items[0].id).toBe(ids[0])
    expect(first.items).toHaveLength(20)
    expect(first.hasMore).toBe(true)
  })

  it('does not skip or repeat entries that share a timestamp', async () => {
    const at = new Date('2026-02-01T00:00:00Z')
    const ids: ChangelogId[] = []
    for (let i = 0; i < 4; i++) {
      const id = createId('changelog') as ChangelogId
      ids.push(id)
      await testDb
        .insert(changelogEntries)
        .values({ id, title: `Tie ${i}`, content: 'b', createdAt: at })
    }
    const asc = await walk('oldest', 1)
    const desc = await walk('newest', 1)
    expect(new Set(asc).size).toBe(4)
    expect([...asc].sort()).toEqual([...ids].sort())
    expect(desc).toEqual([...asc].reverse())
  })
})
