/**
 * Real-Postgres proof of the record a publish keeps when it carries brand
 * assets Import brought in under the person's tick: who published and when
 * (the audit row's own), the site, which assets, and whether the tick was
 * there from the start, worked out from the workspace's own domains.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type UserId, type WorkspaceId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { and, auditLog, eq, settings, sql, user } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { ALL_PERMISSIONS } from '@/lib/shared/permissions'
import { invalidateTierLimitsCache } from '../tier-limits.service'

vi.mock('@/lib/server/db', async (original) => {
  const actual = await original<typeof import('@/lib/server/db')>()
  const { testDb: fixtureDb } = await import('@/lib/server/__tests__/db-test-fixture')
  return { ...actual, db: fixtureDb }
})
vi.mock('@/lib/server/cache', async (original) => ({
  ...(await original<typeof import('@/lib/server/cache')>()),
  cacheDel: vi.fn(async () => {}),
}))

const { publishPortalCustomisation } = await import('../portal-customise.service')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    const current = getExecuteRows<{ name: string }>(
      await db.execute(sql`select current_database() as name`)
    )[0]
    if (!current?.name.startsWith('quackback_test'))
      throw new Error('Portal customise tests require a quackback_test database')
    await db.select({ headerLogoKey: settings.headerLogoKey }).from(settings).limit(0)
  },
})

let settingsId: WorkspaceId
const actor = {
  userId: createId('user') as UserId,
  email: `owner+${createId('user')}@example.com`,
  role: 'admin',
}
const setRow = (values: Partial<typeof settings.$inferInsert>) =>
  testDb.update(settings).set(values).where(eq(settings.id, settingsId))
const audits = () =>
  testDb
    .select()
    .from(auditLog)
    .where(
      and(eq(auditLog.eventType, 'portal.customise.published'), eq(auditLog.targetId, settingsId))
    )

const storedTheme = { themeMode: 'user', light: { primary: '#111111' } }
const loaded = {
  theme: storedTheme,
  logo: { wideKey: 'header-logos/old.png', headerDisplayMode: 'logo_and_name' },
}
const ctx = () => ({ permissions: [...ALL_PERMISSIONS], actor })

beforeEach(async () => {
  await fixture.begin()
  invalidateTierLimitsCache()
  actor.userId = createId('user') as UserId
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
  await setRow({
    brandingConfig: JSON.stringify(storedTheme),
    customCss: null,
    headerLogoKey: 'header-logos/old.png',
    headerDisplayMode: 'logo_and_name',
    tierLimits: null,
    cloudIdentity: null,
    metadata: JSON.stringify({
      stagedUploads: [{ key: 'header-logos/new.png', at: new Date().toISOString() }],
    }),
  })
})
afterEach(async () => {
  await fixture.rollback()
  invalidateTierLimitsCache()
})
afterAll(() => fixture.close())

describe.skipIf(!fixture.available)(
  'publishPortalCustomisation: brand assets from Import (real Postgres)',
  () => {
    const publishLogo = (brandAssets: unknown, context = ctx()) =>
      publishPortalCustomisation(
        {
          before: { logo: loaded.logo },
          logo: { wideKey: 'header-logos/new.png' },
          brandAssets,
        } as never,
        context
      )
    const cloudIdentity = (hostname: string) => ({
      version: 1,
      displayName: 'Acme',
      canonicalOrigin: 'https://acme.quackback.io',
      platformHostname: 'acme.quackback.io',
      customDomains: [
        {
          hostname,
          readiness: 'ready' as const,
          isPrimary: true,
          updatedAt: '2026-11-01T00:00:00.000Z',
        },
      ],
      updatedAt: '2026-11-01T00:00:00.000Z',
    })

    it('records who confirmed them, for which site and which assets', async () => {
      await publishLogo({
        host: 'northwind.com',
        assets: ['logo', 'icon', 'font'],
        preTicked: [],
      })
      const rows = await audits()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        actorEmail: actor.email,
        metadata: {
          parts: ['logo.wideKey'],
          // Only the logo was published: the icon and font are not recorded.
          brandAssets: {
            host: 'northwind.com',
            assets: ['logo'],
            preTicked: [],
            portalOnSite: false,
          },
        },
      })
      expect(rows[0]!.occurredAt).toBeInstanceOf(Date)
    })

    it('records a pre-tick only when the portal really is on the site’s domain', async () => {
      await publishLogo({ host: 'northwind.com', assets: ['logo'], preTicked: ['logo'] })
      expect((await audits())[0]!.metadata).toMatchObject({
        brandAssets: { preTicked: [], portalOnSite: false },
      })
    })

    it('records the pre-tick for a portal on a custom domain of the site', async () => {
      await setRow({ cloudIdentity: cloudIdentity('feedback.northwind.com') })
      await publishLogo({ host: 'northwind.com', assets: ['logo'], preTicked: ['logo'] })
      expect((await audits())[0]!.metadata).toMatchObject({
        brandAssets: { host: 'northwind.com', preTicked: ['logo'], portalOnSite: true },
      })
    })

    it('records as pre-ticked only the carried assets the editor says nobody clicked', async () => {
      await setRow({ cloudIdentity: cloudIdentity('feedback.northwind.com') })
      // The icon was pre-ticked but is not in this publish; the logo was clicked.
      await publishLogo({ host: 'northwind.com', assets: ['logo'], preTicked: ['icon'] })
      expect((await audits())[0]!.metadata).toMatchObject({
        brandAssets: { assets: ['logo'], preTicked: [], portalOnSite: true },
      })
    })

    it('records a copied font with the theme that carries it', async () => {
      const font = 'fonts/2026/11/a-staged-import.woff2'
      await setRow({
        metadata: JSON.stringify({ stagedUploads: [{ key: font, at: new Date().toISOString() }] }),
      })
      await publishPortalCustomisation(
        {
          before: { theme: loaded.theme },
          theme: {
            ...storedTheme,
            customFont: {
              family: 'Calibre',
              fallback: 'inter',
              files: [{ key: font, weight: 100, weightTo: 900, style: 'normal' }],
            },
          },
          brandAssets: {
            host: 'northwind.com',
            assets: ['font', 'headingFont', 'logo'],
            preTicked: [],
          },
        } as never,
        ctx()
      )
      // The text font is carried; the headings font, its own asset, is not.
      expect((await audits())[0]!.metadata).toMatchObject({
        parts: ['theme'],
        brandAssets: { assets: ['font'] },
      })
    })

    it('records nothing when none of the confirmed assets is in the publish', async () => {
      await publishPortalCustomisation(
        {
          before: { theme: loaded.theme },
          theme: { themeMode: 'dark' },
          brandAssets: { host: 'northwind.com', assets: ['logo'], preTicked: [] },
        } as never,
        ctx()
      )
      expect((await audits())[0]!.metadata).toEqual({ parts: ['theme'] })
    })

    it('refuses a confirmation that names no real host or asset', async () => {
      for (const brandAssets of [
        { host: 'not a host', assets: ['logo'], preTicked: [] },
        { host: 'northwind.com', assets: [], preTicked: [] },
        { host: 'northwind.com', assets: ['banner'], preTicked: [] },
        { host: 'northwind.com', assets: ['logo'], preTicked: [], extra: true },
        // The old one-flag shape: a pre-tick must name its assets.
        { host: 'northwind.com', assets: ['logo'], preTicked: true },
      ])
        await expect(publishLogo(brandAssets)).rejects.toThrow()
      expect(await audits()).toHaveLength(0)
    })

    const brandImport = async () => {
      const [row] = await testDb.select({ metadata: settings.metadata }).from(settings).limit(1)
      return (JSON.parse(row!.metadata ?? '{}') as { brandImport?: unknown }).brandImport
    }

    it('keeps the website a published look was imported from, with or without its assets', async () => {
      await publishPortalCustomisation(
        {
          before: { theme: loaded.theme },
          theme: { themeMode: 'dark' },
          importedFrom: 'northwind.com',
        } as never,
        ctx()
      )
      expect(await brandImport()).toEqual({ host: 'northwind.com' })
    })

    it('forgets the import on the next publish made by hand', async () => {
      await setRow({ metadata: JSON.stringify({ brandImport: { host: 'northwind.com' } }) })
      await publishPortalCustomisation(
        { before: { theme: loaded.theme }, theme: { themeMode: 'dark' } } as never,
        ctx()
      )
      expect(await brandImport()).toBeNull()
    })

    it('keeps the import through a publish of words only, such as the portal name', async () => {
      await setRow({
        headerDisplayName: null,
        metadata: JSON.stringify({ brandImport: { host: 'northwind.com' } }),
      })
      const result = await publishPortalCustomisation(
        { before: { headerName: '' }, headerName: 'Northwind' } as never,
        ctx()
      )
      expect(result).toMatchObject({ ok: true, parts: ['headerName'] })
      expect(await brandImport()).toEqual({ host: 'northwind.com' })
    })

    it('leaves the record alone when the publish changes nothing, and refuses a made-up host', async () => {
      await setRow({ metadata: JSON.stringify({ brandImport: { host: 'northwind.com' } }) })
      await publishPortalCustomisation(
        { before: { theme: loaded.theme }, theme: loaded.theme } as never,
        ctx()
      )
      expect(await brandImport()).toEqual({ host: 'northwind.com' })
      await expect(
        publishPortalCustomisation(
          {
            before: { theme: loaded.theme },
            theme: { themeMode: 'dark' },
            importedFrom: '<b>nope</b>',
          } as never,
          ctx()
        )
      ).rejects.toThrow()
      expect(await brandImport()).toEqual({ host: 'northwind.com' })
    })

    describe('refuses imported brand assets nobody confirmed', () => {
      const at = () => new Date().toISOString()
      const LOGO = 'header-logos/2026/11/l-staged-import.svg'
      const ICON = 'logos/2026/11/i-staged-import.png'
      const FAV = 'favicons/2026/11/f-staged-import.png'
      const FONT = 'fonts/2026/11/c-staged-import.woff2'
      const OPEN_FONT = 'fonts/2026/11/o-staged-import.woff2'
      beforeEach(async () => {
        await setRow({
          metadata: JSON.stringify({
            stagedUploads: [
              { key: 'header-logos/new.png', at: at() },
              { key: LOGO, at: at(), brandAsset: true },
              { key: ICON, at: at(), brandAsset: true },
              { key: FAV, at: at(), brandAsset: true },
              { key: FONT, at: at(), brandAsset: true },
              { key: OPEN_FONT, at: at() },
            ],
          }),
        })
      })
      const publishImported = (brandAssets?: unknown) =>
        publishPortalCustomisation(
          {
            before: { theme: loaded.theme, logo: { ...loaded.logo, icon: null } },
            theme: {
              ...storedTheme,
              customFont: {
                family: 'Calibre',
                fallback: 'inter',
                files: [{ key: FONT, weight: 400, style: 'normal' }],
              },
            },
            logo: { wideKey: LOGO, icon: { key: ICON, faviconKey: FAV } },
            ...(brandAssets ? { brandAssets } : {}),
          } as never,
          ctx()
        )
      const stored = async () => {
        const [row] = await testDb
          .select({ wide: settings.headerLogoKey, icon: settings.logoKey })
          .from(settings)
          .limit(1)
        return row
      }

      it('as a value naming each asset, and writes nothing', async () => {
        const result = await publishImported()
        expect(result).toEqual({
          ok: false,
          code: 'BRAND_ASSETS_UNCONFIRMED',
          message: expect.any(String),
          assets: ['logo', 'icon', 'font'],
        })
        expect(await stored()).toMatchObject({ wide: 'header-logos/old.png' })
        expect(await audits()).toHaveLength(0)
      })

      it('names only the assets the confirmation leaves out', async () => {
        const result = await publishImported({
          host: 'northwind.com',
          assets: ['logo'],
          preTicked: [],
        })
        expect(result).toMatchObject({ ok: false, assets: ['icon', 'font'] })
      })

      it('publishes once each asset is confirmed by a click', async () => {
        const result = await publishImported({
          host: 'northwind.com',
          assets: ['logo', 'icon', 'font'],
          preTicked: [],
        })
        expect(result).toMatchObject({ ok: true })
        expect(await stored()).toMatchObject({ wide: LOGO, icon: ICON })
      })

      it('takes a pre-tick as confirmation only on the site’s own domain', async () => {
        const preTicked = { host: 'northwind.com', assets: ['logo', 'icon', 'font'] }
        expect(await publishImported({ ...preTicked, preTicked: ['logo'] })).toMatchObject({
          ok: false,
          assets: ['logo'],
        })
        await setRow({ cloudIdentity: cloudIdentity('feedback.northwind.com') })
        expect(
          await publishImported({ ...preTicked, preTicked: ['logo', 'icon', 'font'] })
        ).toMatchObject({ ok: true })
      })

      it('asks nothing of uploads that are not imported brand assets, nor of what is live', async () => {
        // A logo uploaded by hand, and an open-licence font copied from a site.
        expect(await publishLogo(undefined)).toMatchObject({ ok: true })
        const result = await publishPortalCustomisation(
          {
            before: { theme: loaded.theme },
            theme: {
              ...storedTheme,
              customFont: {
                family: 'Open',
                fallback: 'inter',
                files: [{ key: OPEN_FONT, weight: 400, style: 'normal' }],
              },
            },
          } as never,
          ctx()
        )
        expect(result).toMatchObject({ ok: true })
        // Live already: a publish of something else carries no asset to confirm.
        await publishImported({
          host: 'northwind.com',
          assets: ['logo', 'icon', 'font'],
          preTicked: [],
        })
        expect(
          await publishPortalCustomisation(
            {
              before: { headerName: '' },
              headerName: 'Northwind',
            } as never,
            ctx()
          )
        ).toMatchObject({ ok: true })
      })
    })
  }
)
