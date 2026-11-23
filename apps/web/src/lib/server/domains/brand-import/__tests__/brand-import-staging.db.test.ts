/**
 * Real-Postgres proof that Import saves nothing: the imported logo is
 * uploaded and its key handed to the editor, the settings row is unchanged,
 * and only a publish with that key makes it the header logo.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type UserId, type WorkspaceId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, settings, sql, user } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { ALL_PERMISSIONS } from '@/lib/shared/permissions'
import { wideLogoKeySchema } from '@/lib/shared/schemas/portal-customise'
import type { FetchedBody, SiteFetcher } from '../site/types'

const seams = vi.hoisted(() => ({
  uploads: [] as string[],
  deleted: [] as string[],
}))

vi.mock('@/lib/server/db', async (original) => {
  const actual = await original<typeof import('@/lib/server/db')>()
  const { testDb: fixtureDb } = await import('@/lib/server/__tests__/db-test-fixture')
  return { ...actual, db: fixtureDb }
})
vi.mock('@/lib/server/cache', async (original) => ({
  ...(await original<typeof import('@/lib/server/cache')>()),
  cacheDel: async () => {},
}))
vi.mock('@/lib/server/utils/rate-bucket', () => ({ incrementBuckets: async () => [1, 1] }))
vi.mock('@/lib/server/storage/s3', async (original) => ({
  ...(await original<typeof import('@/lib/server/storage/s3')>()),
  isS3Usable: () => true,
  uploadObject: async (key: string) => {
    seams.uploads.push(key)
    return `https://cdn.example/${key}`
  },
  deleteObject: async (key: string) => {
    seams.deleted.push(key)
  },
}))

const { importBrand } = await import('../brand-import.service')
const { publishPortalCustomisation } =
  await import('@/lib/server/domains/settings/portal-customise.service')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    const current = getExecuteRows<{ name: string }>(
      await db.execute(sql`select current_database() as name`)
    )[0]
    if (!current?.name.startsWith('quackback_test'))
      throw new Error('Brand import tests require a quackback_test database')
    await db.select({ headerLogoKey: settings.headerLogoKey }).from(settings).limit(0)
  },
})
if (!fixture.available)
  throw new Error('Migrate a quackback_test database before running brand import tests')

const ok = (body: string, contentType: string): FetchedBody => ({
  status: 200,
  url: '',
  contentType,
  body: new TextEncoder().encode(body),
})
const routes: Record<string, FetchedBody> = {
  'https://acme.example/': ok(
    `<html><head><meta name="theme-color" content="#1f4d3a"></head><body><header><a href="/"><svg viewBox="0 0 120 30"><path d="M0 0h120v30H0z"/></svg></a></header></body></html>`,
    'text/html'
  ),
}
const fetcher: SiteFetcher = async (url) => (routes[url] ? { ...routes[url], url } : null)

let settingsId: WorkspaceId
const actor = { userId: createId('user') as UserId, email: 'owner@example.com', role: 'admin' }
const read = async () =>
  (await testDb.select().from(settings).where(eq(settings.id, settingsId)))[0]

beforeEach(async () => {
  await fixture.begin()
  seams.uploads.length = 0
  seams.deleted.length = 0
  actor.userId = createId('user') as UserId
  actor.email = `owner+${actor.userId}@example.com`
  await testDb.insert(user).values({ id: actor.userId, name: 'Owner', email: actor.email })
  const [existing] = await testDb.select().from(settings).limit(1)
  const row =
    existing ??
    (
      await testDb
        .insert(settings)
        .values({ name: 'Acme', slug: `acme-${createId('user')}`, createdAt: new Date() })
        .returning()
    )[0]
  settingsId = row.id
  await testDb
    .update(settings)
    .set({ headerLogoKey: null, headerDisplayMode: 'logo_and_name', brandingConfig: null })
    .where(eq(settings.id, settingsId))
})
afterEach(() => fixture.rollback())
afterAll(() => fixture.close())

describe('an imported logo (real Postgres)', () => {
  it('is uploaded but saved to no setting until a publish names it', async () => {
    const before = await read()
    const imported = await importBrand('acme.example', { fetcher })

    expect(imported.logo?.kind).toBe('wide')
    const stagedKey = imported.logo!.stagedKey
    expect(seams.uploads).toEqual([stagedKey])
    expect(stagedKey).toMatch(/^header-logos\//)
    // The key passes the publish fn's own check of a wide logo key.
    expect(wideLogoKeySchema.safeParse(stagedKey).success).toBe(true)
    // Only the staged list changed: the sweep removes the upload if no publish names it.
    const staged = await read()
    expect({ ...staged, metadata: before.metadata }).toEqual(before)
    // Marked as a brand asset: a publish puts it live only with a confirmation.
    expect(JSON.parse(staged.metadata!).stagedUploads).toEqual([
      { key: stagedKey, at: expect.any(String), brandAsset: true },
    ])

    const publish = (confirmed: boolean) =>
      publishPortalCustomisation(
        {
          before: { logo: { wideKey: null, headerDisplayMode: 'logo_and_name' } },
          logo: { wideKey: stagedKey, headerDisplayMode: 'custom_logo' },
          ...(confirmed
            ? { brandAssets: { host: 'acme.example', assets: ['logo'], preTicked: [] } }
            : {}),
        },
        { permissions: [...ALL_PERMISSIONS], actor }
      )
    // Unconfirmed, it is refused and nothing is saved.
    expect(await publish(false)).toMatchObject({ ok: false, code: 'BRAND_ASSETS_UNCONFIRMED' })
    expect((await read()).headerLogoKey).toBe(before.headerLogoKey)
    expect(await publish(true)).toMatchObject({ ok: true })
    const after = await read()
    expect(after.headerLogoKey).toBe(stagedKey)
    expect(after.headerDisplayMode).toBe('custom_logo')
    expect(JSON.parse(after.metadata!).stagedUploads ?? []).toEqual([])
    expect(seams.deleted).toEqual([])
  })
})
