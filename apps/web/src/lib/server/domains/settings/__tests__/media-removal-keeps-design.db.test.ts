/**
 * Removing or replacing a logo in Settings › General only clears the
 * settings' pointer. The stored image stays, since a published design, its
 * draft, a kept revision, a preview link or a saved look can still name it:
 * the portal header, favicon, share card and emails would otherwise point at
 * a deleted object that no restore can bring back.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, settings, user } from '@/lib/server/db'

/** The bucket: the stored objects by key. */
const bucket = vi.hoisted(() => new Set<string>())

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/storage/s3', async (original) => ({
  ...(await original<typeof import('@/lib/server/storage/s3')>()),
  deleteObject: async (key: string) => {
    bucket.delete(key)
  },
}))
vi.mock('@/lib/server/cache', async (original) => ({
  ...(await original<typeof import('@/lib/server/cache')>()),
  cacheGet: vi.fn(async () => null),
  cacheSet: vi.fn(async () => undefined),
  cacheDel: vi.fn(async () => undefined),
}))
vi.mock('@/lib/server/local-cache', async (original) => ({
  ...(await original<typeof import('@/lib/server/local-cache')>()),
  localCacheGet: () => undefined,
  localCacheSet: () => undefined,
}))

const media = await import('../settings.media')
const { getPublishedDesign, publishDraft, saveDraft } =
  await import('@/lib/server/domains/design/design.service')
const { defaultDesign } = await import('@/lib/shared/design/schema')

const LOGO = 'logos/acme.png'
const FAVICON = 'favicons/acme.png'
const HEADER = 'header-logos/acme-wordmark.png'

const fixture = await createDbTestFixture()
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  await testDb.delete(settings)
  await testDb.insert(settings).values({
    id: createId('workspace'),
    name: 'Acme',
    slug: `acme-${createId('workspace').slice(-8)}`,
    createdAt: new Date(),
    featureFlags: JSON.stringify({ portalDesignV2: true }),
    logoKey: LOGO,
    faviconKey: FAVICON,
    headerLogoKey: HEADER,
  })
  bucket.clear()
  for (const key of [LOGO, FAVICON, HEADER]) bucket.add(key)
})
afterEach(fixture.rollback)
afterAll(fixture.close)

/** Publishes a design that uses the workspace's logo, favicon and header logo. */
async function publishWithWorkspaceMedia() {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Admin', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'admin', type: 'user', createdAt: new Date() })
  const doc = defaultDesign()
  doc.brand.logo.mark.light = { key: LOGO }
  doc.brand.logo.wordmark.light = { key: HEADER }
  doc.brand.favicon = { key: FAVICON }
  const author = {
    principalId,
    actor: { userId, email: `${userId}@example.com`, role: 'admin', type: 'user' as const },
  }
  await saveDraft(doc, author)
  await publishDraft({ ...author, source: 'api' })
}

const row = async () => (await testDb.select().from(settings))[0]!

describe('removing workspace media in General', () => {
  it('keeps the logo and favicon the published design still shows', async () => {
    await publishWithWorkspaceMedia()
    await media.deleteLogoKey()

    expect(await row()).toMatchObject({ logoKey: null, faviconKey: null })
    const published = await getPublishedDesign()
    expect(published?.brand.logo.mark.light).toEqual({ key: LOGO })
    expect(published?.brand.favicon).toEqual({ key: FAVICON })
    expect(bucket.has(LOGO)).toBe(true)
    expect(bucket.has(FAVICON)).toBe(true)
  })

  it('keeps the favicon when only the favicon is removed', async () => {
    await publishWithWorkspaceMedia()
    await media.deleteFaviconKey()
    expect((await row()).faviconKey).toBeNull()
    expect(bucket.has(FAVICON)).toBe(true)
  })

  it('keeps the header logo when it is replaced or removed', async () => {
    await publishWithWorkspaceMedia()
    bucket.add('header-logos/new.png')
    await media.saveHeaderLogoKey('header-logos/new.png')
    expect((await row()).headerLogoKey).toBe('header-logos/new.png')
    expect(bucket.has(HEADER)).toBe(true)

    await media.deleteHeaderLogoKey()
    expect((await row()).headerLogoKey).toBeNull()
    expect(bucket.has('header-logos/new.png')).toBe(true)
    expect(bucket.has(HEADER)).toBe(true)
  })
})
