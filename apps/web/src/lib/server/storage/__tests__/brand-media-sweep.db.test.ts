/**
 * The brand media sweep deletes an old object only when no setting, design or
 * capture names it, and never touches a young one.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { portalDesigns, settings } from '@/lib/server/db'
import { defaultDesign } from '@/lib/shared/design/schema'
import type { StoredObject } from '../s3'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const { sweepUnusedBrandMedia, BRAND_MEDIA_MIN_AGE_MS } = await import('../brand-media-sweep')

const NOW = new Date('2026-11-11T12:00:00Z')
const OLD = new Date(NOW.getTime() - BRAND_MEDIA_MIN_AGE_MS - 60_000)
const YOUNG = new Date(NOW.getTime() - 60_000)

/** A bucket held in memory: what the sweep lists, and what is left after it deletes. */
function bucket(objects: StoredObject[]) {
  const held = new Map(objects.map((o) => [o.key, o]))
  return {
    held,
    async listUnder(prefix: string) {
      return { objects: [...held.values()].filter((o) => o.key.startsWith(prefix)) }
    },
    async remove(key: string) {
      held.delete(key)
    },
  }
}

const fixture = await createDbTestFixture()
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  await testDb.delete(portalDesigns)
  await testDb.delete(settings)
  await testDb.insert(settings).values({
    id: createId('workspace'),
    name: 'Acme',
    slug: `acme-${createId('workspace').slice(-8)}`,
    createdAt: new Date(),
    logoKey: 'logos/current.png',
  })
  const draft = defaultDesign() as unknown as Record<string, unknown>
  draft.heroImage = { asset: 'portal-images/hero.png' }
  const welcome = defaultDesign()
  welcome.pages.feedback.welcome = {
    show: true,
    body: {
      type: 'doc',
      content: [{ type: 'image', attrs: { src: '/api/storage/header-logos/in-welcome.png' } }],
    },
  }
  await testDb.insert(portalDesigns).values({ draft: { ...welcome, extra: draft.heroImage } })
})
afterEach(() => fixture.rollback())
afterAll(() => fixture.close())

describe('sweepUnusedBrandMedia', () => {
  it('keeps referenced and young objects, and deletes old unreferenced ones', async () => {
    const store = bucket([
      { key: 'logos/current.png', lastModified: OLD },
      { key: 'portal-images/hero.png', lastModified: OLD },
      { key: 'header-logos/in-welcome.png', lastModified: OLD },
      { key: 'logos/removed.png', lastModified: OLD },
      { key: 'favicons/just-uploaded.png', lastModified: YOUNG },
    ])
    const result = await sweepUnusedBrandMedia({ storage: store, now: NOW })
    expect(result.deleted).toEqual(['logos/removed.png'])
    expect([...store.held.keys()].sort()).toEqual([
      'favicons/just-uploaded.png',
      'header-logos/in-welcome.png',
      'logos/current.png',
      'portal-images/hero.png',
    ])
    expect(result).toMatchObject({ referenced: 3, young: 1, failed: 0 })
  })

  it('reports without deleting in a dry run', async () => {
    const store = bucket([{ key: 'logos/removed.png', lastModified: OLD }])
    const result = await sweepUnusedBrandMedia({ storage: store, now: NOW, dryRun: true })
    expect(result.deleted).toEqual(['logos/removed.png'])
    expect(store.held.has('logos/removed.png')).toBe(true)
  })

  it('keeps an object whose age is unknown', async () => {
    const store = bucket([{ key: 'logos/removed.png', lastModified: null }])
    await sweepUnusedBrandMedia({ storage: store, now: NOW })
    expect(store.held.has('logos/removed.png')).toBe(true)
  })
})
