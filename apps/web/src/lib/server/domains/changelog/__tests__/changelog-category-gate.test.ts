import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type ChangelogId, type PrincipalId, type SegmentId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { changelogCategories, changelogEntries, changelogEntryCategories } from '@/lib/server/db'
import { categoryGateAllows } from '../changelog-category.service'
import { listPublicChangelogs } from '../changelog.public'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: changelogCategories.id, segmentIds: changelogCategories.segmentIds })
      .from(changelogCategories)
      .limit(0)
  },
})

function userActor(segmentIds: string[]): Actor {
  return {
    principalId: 'principal_01user' as PrincipalId,
    role: 'user',
    principalType: 'user',
    segmentIds: new Set(segmentIds as SegmentId[]),
  }
}

function teamActor(): Actor {
  return {
    principalId: 'principal_01team' as PrincipalId,
    role: 'admin',
    principalType: 'user',
    segmentIds: new Set(),
  }
}

describe('categoryGateAllows', () => {
  it('allows when the entry has no categories', () => {
    expect(categoryGateAllows([], ANONYMOUS_ACTOR)).toBe(true)
  })

  it('allows when every category is ungated (empty segmentIds = everyone)', () => {
    const categories = [{ segmentIds: [] }, { segmentIds: [] }]
    expect(categoryGateAllows(categories, ANONYMOUS_ACTOR)).toBe(true)
  })

  it('denies an anonymous actor when any category is segment-gated', () => {
    const categories = [{ segmentIds: ['seg_enterprise'] }]
    expect(categoryGateAllows(categories, ANONYMOUS_ACTOR)).toBe(false)
  })

  it('denies a signed-in user who is not a member of the gating segment', () => {
    const categories = [{ segmentIds: ['seg_enterprise'] }]
    expect(categoryGateAllows(categories, userActor(['seg_other']))).toBe(false)
  })

  it('allows a signed-in user who is a member of the gating segment', () => {
    const categories = [{ segmentIds: ['seg_enterprise'] }]
    expect(categoryGateAllows(categories, userActor(['seg_enterprise']))).toBe(true)
  })

  it('requires ALL gated categories to pass (AND semantics)', () => {
    const categories = [{ segmentIds: ['seg_a'] }, { segmentIds: ['seg_b'] }]
    // Member of seg_a only — still denied because seg_b also gates.
    expect(categoryGateAllows(categories, userActor(['seg_a']))).toBe(false)
    expect(categoryGateAllows(categories, userActor(['seg_a', 'seg_b']))).toBe(true)
  })

  it('a mix of gated and ungated categories only enforces the gated one', () => {
    const categories = [{ segmentIds: [] }, { segmentIds: ['seg_a'] }]
    expect(categoryGateAllows(categories, userActor(['seg_a']))).toBe(true)
    expect(categoryGateAllows(categories, userActor([]))).toBe(false)
  })

  it('team actors bypass the gate entirely', () => {
    const categories = [{ segmentIds: ['seg_enterprise'] }]
    expect(categoryGateAllows(categories, teamActor())).toBe(true)
  })
})

describe.skipIf(!fixture.available)(
  'listPublicChangelogs with label-gated entries (real DB)',
  () => {
    beforeEach(fixture.begin)
    afterEach(fixture.rollback)
    afterAll(fixture.close)

    const BASE = Date.parse('2026-02-01T00:00:00Z')
    const minutes = (n: number) => new Date(BASE + n * 60_000)

    // The three newest entries carry a label restricted to a segment the
    // anonymous viewer is not in; the oldest one is open to everyone.
    async function seedGatedNewest(): Promise<{ open: ChangelogId }> {
      const [gate] = await testDb
        .insert(changelogCategories)
        .values({
          name: `Enterprise ${createId('changelog_category')}`,
          color: '#000000',
          segmentIds: ['segment_enterprise'],
        })
        .returning()
      const open = createId('changelog') as ChangelogId
      await testDb
        .insert(changelogEntries)
        .values({ id: open, title: 'Open', content: 'body', publishedAt: minutes(0) })
      for (let i = 1; i <= 3; i++) {
        const id = createId('changelog') as ChangelogId
        await testDb
          .insert(changelogEntries)
          .values({ id, title: `Gated ${i}`, content: 'body', publishedAt: minutes(i) })
        await testDb
          .insert(changelogEntryCategories)
          .values({ changelogEntryId: id, categoryId: gate.id })
      }
      return { open }
    }

    it('CHG-P-05 the first page already holds the open entry behind gated ones', async () => {
      const { open } = await seedGatedNewest()

      const page = await listPublicChangelogs({ limit: 2 }, ANONYMOUS_ACTOR)

      expect(page.items.map((e) => e.id)).toEqual([open])
      expect(page.hasMore).toBe(false)
    })
    it('CHG-P-05 a fully gated page is not returned empty with more to load', async () => {
      await seedGatedNewest()

      const page = await listPublicChangelogs({ limit: 2 }, ANONYMOUS_ACTOR)

      expect({ empty: page.items.length === 0, hasMore: page.hasMore }).not.toEqual({
        empty: true,
        hasMore: true,
      })
    })
  }
)
