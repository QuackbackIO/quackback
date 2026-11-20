/**
 * Real-Postgres proof that a portal customisation publish is one atomic
 * write: every part or none, refused whole on a missing permission or plan,
 * refused (as a value) when someone else changed a part it publishes, one
 * cache invalidation, the old wide logo deleted only once the new one is
 * committed, and an audit row in the same transaction.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type UserId, type WorkspaceId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { and, auditLog, eq, settings, sql, user } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { ALL_PERMISSIONS, PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { ForbiddenError } from '@/lib/shared/errors'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { invalidateTierLimitsCache } from '../tier-limits.service'

const seams = vi.hoisted(() => ({
  cacheDel: vi.fn(async (..._keys: string[]) => {}),
  deleted: [] as Array<{ key: string; storedAtDelete: string | null | undefined }>,
  readWideKey: null as null | (() => Promise<string | null | undefined>),
  failAudit: false,
  globalDbCalls: [] as string[],
}))

// The global `db` is the fixture transaction, behind a proxy that records
// what the code under test asks of it directly. Every write must go through
// the publish transaction: a writer that ignored its executor would, in
// production, wait on the row lock its own transaction holds.
vi.mock('@/lib/server/db', async (original) => {
  const actual = await original<typeof import('@/lib/server/db')>()
  const { testDb: fixtureDb } = await import('@/lib/server/__tests__/db-test-fixture')
  return {
    ...actual,
    db: new Proxy(
      {},
      {
        get(_, prop) {
          seams.globalDbCalls.push(String(prop))
          const target = fixtureDb as unknown as Record<string | symbol, unknown>
          const value = target[prop]
          return typeof value === 'function' ? value.bind(target) : value
        },
      }
    ),
  }
})
vi.mock('@/lib/server/cache', async (original) => ({
  ...(await original<typeof import('@/lib/server/cache')>()),
  cacheDel: seams.cacheDel,
}))
vi.mock('@/lib/server/storage/s3', async (original) => ({
  ...(await original<typeof import('@/lib/server/storage/s3')>()),
  deleteObject: async (key: string) => {
    seams.deleted.push({ key, storedAtDelete: await seams.readWideKey?.() })
  },
}))
vi.mock('@/lib/server/audit/log', async (original) => {
  const actual = await original<typeof import('@/lib/server/audit/log')>()
  return {
    ...actual,
    recordAuditEventInTransaction: async (
      ...args: Parameters<typeof actual.recordAuditEventInTransaction>
    ) => {
      if (seams.failAudit) throw new Error('Audit refused')
      return actual.recordAuditEventInTransaction(...args)
    },
  }
})

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
if (!fixture.available)
  throw new Error('Migrate a quackback_test database before running portal customise tests')

let settingsId: WorkspaceId
const actor = {
  userId: createId('user') as UserId,
  email: `owner+${createId('user')}@example.com`,
  role: 'admin',
}
const everything: PermissionKey[] = [...ALL_PERMISSIONS]
const brandingOnly: PermissionKey[] = [PERMISSIONS.SETTINGS_BRANDING]

const read = async () =>
  (await testDb.select().from(settings).where(eq(settings.id, settingsId)))[0]
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
const navItems = [{ id: 'feedback', type: 'feedback' as const, enabled: true }]
const welcomeBody = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
}
const storedPortal = {
  nav: { items: navItems },
  welcomeCard: { body: welcomeBody },
  features: { allowAnonymous: false },
}

/** What the editor loaded: the parts as the read path returns them. */
const loaded = {
  theme: storedTheme,
  customCss: '',
  portal: { nav: { items: navItems }, welcomeCard: { body: welcomeBody } },
  helpCenter: {
    homepageTitle: 'How can we help?',
    homepageDescription: 'Search our knowledge base or browse by category',
    headerLinks: [],
  },
  logo: { wideKey: 'header-logos/old.png', headerDisplayMode: 'logo_and_name' },
}

const ctx = (permissions: PermissionKey[] = everything) => ({ permissions, actor })

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
    portalConfig: JSON.stringify(storedPortal),
    helpCenterConfig: null,
    headerLogoKey: 'header-logos/old.png',
    headerDisplayMode: 'logo_and_name',
    tierLimits: null,
    // The editor staged the new wide logo when it uploaded it.
    metadata: JSON.stringify({
      other: { kept: true },
      stagedUploads: [{ key: 'header-logos/new.png', at: new Date().toISOString() }],
    }),
  })
  seams.readWideKey = async () => (await read()).headerLogoKey
  seams.cacheDel.mockClear()
  seams.deleted.length = 0
  seams.failAudit = false
  seams.globalDbCalls.length = 0
})
afterEach(async () => {
  await fixture.rollback()
  invalidateTierLimitsCache()
})
afterAll(() => fixture.close())

describe('publishPortalCustomisation (real Postgres)', () => {
  it('writes theme, css, tabs and welcome message together and returns the stored values', async () => {
    const theme = { themeMode: 'dark' as const, light: { primary: '#222222' } }
    const items = [{ id: 'roadmap', type: 'roadmap' as const, enabled: true }]
    const result = await publishPortalCustomisation(
      {
        before: {
          theme: loaded.theme,
          customCss: loaded.customCss,
          portal: loaded.portal,
        },
        theme,
        customCss: '',
        portal: { nav: { items }, welcomeCard: { body: welcomeBody } },
      },
      ctx()
    )

    expect(result).toMatchObject({ ok: true, parts: ['theme', 'portal.nav'] })
    const row = await read()
    expect(JSON.parse(row.brandingConfig!)).toEqual(theme)
    const portal = JSON.parse(row.portalConfig!)
    expect(portal.nav).toEqual({ items })
    expect(portal.features).toMatchObject({ allowAnonymous: false })
    if (!result.ok) throw new Error('expected a publish')
    expect(result.published.theme).toEqual(theme)
    expect(result.published.portal?.nav).toEqual({ items })
  })

  it('can publish again with the returned values as before, without a reload', async () => {
    const first = await publishPortalCustomisation(
      {
        before: { theme: loaded.theme, portal: { nav: loaded.portal.nav } },
        theme: { themeMode: 'light', light: { primary: '#333333' } },
        portal: { nav: { items: [{ id: 'roadmap', type: 'roadmap' }] } },
      },
      ctx()
    )
    if (!first.ok) throw new Error('expected a publish')
    const second = await publishPortalCustomisation(
      {
        before: first.published,
        theme: { themeMode: 'dark', light: { primary: '#333333' } },
        portal: { nav: { items: [{ id: 'feedback', type: 'feedback' }] } },
      },
      ctx()
    )
    expect(second).toMatchObject({ ok: true, parts: ['theme', 'portal.nav'] })
  })

  describe('permissions', () => {
    it('lets a branding-only role publish the theme, Advanced CSS, tabs, welcome message and wide logo', async () => {
      const result = await publishPortalCustomisation(
        {
          before: {
            theme: loaded.theme,
            customCss: loaded.customCss,
            portal: loaded.portal,
            logo: loaded.logo,
          },
          theme: { themeMode: 'light' },
          customCss: '',
          portal: {
            nav: { items: [{ id: 'roadmap', type: 'roadmap' }] },
            welcomeCard: { body: { type: 'doc', content: [{ type: 'paragraph' }] } },
          },
          logo: { wideKey: 'header-logos/new.png', headerDisplayMode: 'custom_logo' },
        },
        ctx(brandingOnly)
      )
      expect(result.ok).toBe(true)
    })

    it('refuses the whole publish when one part needs a permission the caller lacks, naming it', async () => {
      const attempt = publishPortalCustomisation(
        {
          before: { theme: loaded.theme, helpCenter: { homepageTitle: 'How can we help?' } },
          theme: { themeMode: 'dark' },
          helpCenter: { homepageTitle: 'Support' },
        },
        ctx(brandingOnly)
      )
      await expect(attempt).rejects.toBeInstanceOf(ForbiddenError)
      await expect(attempt).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
        message: expect.stringContaining('the Help Center home'),
      })
      expect(JSON.parse((await read()).brandingConfig!)).toEqual(storedTheme)
    })

    it('refuses the theme to a caller with only Help Center permission', async () => {
      await expect(
        publishPortalCustomisation(
          { before: { theme: loaded.theme }, theme: { themeMode: 'dark' } },
          ctx([PERMISSIONS.HELP_CENTER_MANAGE])
        )
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    })

    it('lets a Help Center manager publish the Help Center home', async () => {
      const result = await publishPortalCustomisation(
        {
          before: { helpCenter: loaded.helpCenter },
          helpCenter: {
            homepageTitle: 'Support',
            homepageDescription: 'Ask us',
            headerLinks: [{ label: 'Status', url: 'https://status.example.com' }],
          },
        },
        ctx([PERMISSIONS.HELP_CENTER_MANAGE])
      )
      expect(result).toMatchObject({
        ok: true,
        parts: [
          'helpCenter.homepageTitle',
          'helpCenter.homepageDescription',
          'helpCenter.headerLinks',
        ],
      })
      expect(JSON.parse((await read()).helpCenterConfig!)).toMatchObject({
        homepageTitle: 'Support',
        homepageDescription: 'Ask us',
        headerLinks: [{ label: 'Status', url: 'https://status.example.com' }],
      })
    })
  })

  describe('plan', () => {
    it('refuses Advanced CSS rules off-plan with TierLimitError and writes nothing, theme included', async () => {
      await setRow({ tierLimits: JSON.stringify({ features: { customCss: false } }) })
      invalidateTierLimitsCache()
      const attempt = publishPortalCustomisation(
        {
          before: { theme: loaded.theme, customCss: '', portal: { nav: loaded.portal.nav } },
          theme: { themeMode: 'dark' },
          customCss: '.brand { color: red; }',
          portal: { nav: { items: [{ id: 'roadmap', type: 'roadmap' }] } },
        },
        ctx()
      )
      await expect(attempt).rejects.toBeInstanceOf(TierLimitError)
      const row = await read()
      expect(JSON.parse(row.brandingConfig!)).toEqual(storedTheme)
      expect(row.customCss).toBeNull()
      expect(JSON.parse(row.portalConfig!).nav).toEqual({ items: navItems })
      expect(await audits()).toHaveLength(0)
      expect(seams.cacheDel).not.toHaveBeenCalled()
    })

    it('refuses custom colours off-plan and writes nothing', async () => {
      await setRow({ tierLimits: JSON.stringify({ features: { customColors: false } }) })
      invalidateTierLimitsCache()
      await expect(
        publishPortalCustomisation(
          {
            before: { theme: loaded.theme, portal: { nav: loaded.portal.nav } },
            theme: { themeMode: 'dark', light: { primary: '#ff0000' } },
            portal: { nav: { items: [] } },
          },
          ctx()
        )
      ).rejects.toBeInstanceOf(TierLimitError)
      expect(JSON.parse((await read()).portalConfig!).nav).toEqual({ items: navItems })
    })

    it('lets empty CSS and the stored remainder through off-plan', async () => {
      const stored = ':root { --primary: #000; }\n.brand { color: red; }'
      await setRow({
        customCss: stored,
        tierLimits: JSON.stringify({ features: { customCss: false } }),
      })
      invalidateTierLimitsCache()
      const result = await publishPortalCustomisation(
        { before: { customCss: stored }, customCss: '.brand { color: red; }' },
        ctx()
      )
      expect(result).toMatchObject({ ok: true, parts: ['customCss'] })
    })
  })

  describe('conflicts', () => {
    it('refuses with SETTINGS_CHANGED and the current value when a published part changed since loading', async () => {
      const theirs = { items: [{ id: 'changelog', type: 'changelog' }] }
      await setRow({ portalConfig: JSON.stringify({ ...storedPortal, nav: theirs }) })
      const result = await publishPortalCustomisation(
        {
          before: { theme: loaded.theme, portal: { nav: loaded.portal.nav } },
          theme: { themeMode: 'dark' },
          portal: { nav: { items: [{ id: 'roadmap', type: 'roadmap' }] } },
        },
        ctx()
      )
      expect(result).toEqual({
        ok: false,
        code: 'SETTINGS_CHANGED',
        message: expect.any(String),
        parts: ['portal.nav'],
        current: { portal: { nav: theirs } },
      })
      const row = await read()
      expect(JSON.parse(row.brandingConfig!)).toEqual(storedTheme)
      expect(JSON.parse(row.portalConfig!).nav).toEqual(theirs)
      expect(await audits()).toHaveLength(0)
      expect(seams.cacheDel).not.toHaveBeenCalled()
    })

    it('does not conflict on a change to a part it does not publish, and keeps that change', async () => {
      const theirs = { items: [{ id: 'changelog', type: 'changelog' }] }
      await setRow({
        portalConfig: JSON.stringify({
          ...storedPortal,
          nav: theirs,
          features: { allowAnonymous: true },
        }),
      })
      const result = await publishPortalCustomisation(
        {
          before: { portal: { welcomeCard: loaded.portal.welcomeCard } },
          portal: { welcomeCard: { body: { type: 'doc', content: [{ type: 'paragraph' }] } } },
        },
        ctx()
      )
      expect(result).toMatchObject({ ok: true, parts: ['portal.welcomeCard'] })
      const portal = JSON.parse((await read()).portalConfig!)
      expect(portal.nav).toEqual(theirs)
      expect(portal.features.allowAnonymous).toBe(true)
    })

    it('reads an absent stored value the way the read path does', async () => {
      await setRow({ brandingConfig: null, customCss: null })
      const result = await publishPortalCustomisation(
        { before: { theme: {}, customCss: '' }, theme: { themeMode: 'dark' }, customCss: '' },
        ctx()
      )
      expect(result).toMatchObject({ ok: true, parts: ['theme'] })
    })

    it('refuses a part sent without the value it replaces', async () => {
      await expect(
        publishPortalCustomisation({ before: {}, theme: { themeMode: 'dark' } }, ctx())
      ).rejects.toMatchObject({ code: 'PUBLISH_BEFORE_REQUIRED' })
    })
  })

  it('leaves unchanged parts out: no write, no audit entry', async () => {
    const result = await publishPortalCustomisation(
      {
        before: { theme: loaded.theme, portal: { nav: loaded.portal.nav } },
        theme: storedTheme as { themeMode: 'user' },
        portal: { nav: { items: [{ id: 'roadmap', type: 'roadmap' }] } },
      },
      ctx()
    )
    expect(result).toMatchObject({ ok: true, parts: ['portal.nav'] })
    const [row] = await audits()
    expect(row.metadata).toEqual({ parts: ['portal.nav'] })
  })

  it('invalidates the settings cache once, after the writes', async () => {
    await publishPortalCustomisation(
      {
        before: { theme: loaded.theme, customCss: '', portal: loaded.portal, logo: loaded.logo },
        theme: { themeMode: 'dark' },
        customCss: '',
        portal: {
          nav: { items: [{ id: 'roadmap', type: 'roadmap' }] },
          welcomeCard: { body: { type: 'doc', content: [{ type: 'paragraph' }] } },
        },
        logo: { wideKey: 'header-logos/new.png', headerDisplayMode: 'custom_logo' },
      },
      ctx()
    )
    expect(seams.cacheDel).toHaveBeenCalledOnce()
  })

  it('writes only through its transaction, never the global connection', async () => {
    await publishPortalCustomisation(
      {
        before: {
          theme: loaded.theme,
          customCss: '',
          portal: loaded.portal,
          helpCenter: loaded.helpCenter,
          logo: loaded.logo,
        },
        theme: { themeMode: 'dark' },
        customCss: '.x { color: red; }',
        portal: {
          nav: { items: [{ id: 'roadmap', type: 'roadmap' }] },
          welcomeCard: { body: { type: 'doc', content: [{ type: 'paragraph' }] } },
        },
        helpCenter: { homepageTitle: 'Support', homepageDescription: 'x', headerLinks: [] },
        logo: { wideKey: null, headerDisplayMode: 'logo_only' },
      },
      ctx()
    )
    const writes = seams.globalDbCalls.filter((call) =>
      ['update', 'insert', 'delete', 'execute'].includes(call)
    )
    expect(writes).toEqual([])
    expect(seams.globalDbCalls).toContain('transaction')
  })

  describe('icon', () => {
    const oldIcon = { key: 'logos/old.png', faviconKey: 'favicons/old.png' }
    const newIcon = { key: 'logos/new.png', faviconKey: 'favicons/new.png' }
    beforeEach(async () => {
      await setRow({
        logoKey: oldIcon.key,
        faviconKey: oldIcon.faviconKey,
        metadata: JSON.stringify({
          stagedUploads: [
            { key: newIcon.key, at: new Date().toISOString() },
            { key: newIcon.faviconKey, at: new Date().toISOString() },
          ],
        }),
      })
    })

    it('publishes a staged icon with its favicon, keeping the old one for a settings undo', async () => {
      const result = await publishPortalCustomisation(
        { before: { logo: { icon: oldIcon } }, logo: { icon: newIcon } },
        ctx()
      )
      expect(result).toMatchObject({
        ok: true,
        parts: ['logo.icon'],
        published: { logo: { icon: newIcon } },
      })
      const row = await read()
      expect([row.logoKey, row.faviconKey]).toEqual([newIcon.key, newIcon.faviconKey])
      expect(JSON.parse(row.metadata!).stagedUploads).toEqual([])
      expect(seams.deleted).toEqual([])
    })

    it('is published by someone who may manage settings, not by branding alone', async () => {
      await expect(
        publishPortalCustomisation(
          { before: { logo: { icon: oldIcon } }, logo: { icon: newIcon } },
          ctx(brandingOnly)
        )
      ).rejects.toBeInstanceOf(ForbiddenError)
      expect((await read()).logoKey).toBe(oldIcon.key)
    })

    it('refuses an icon that is no longer uploaded', async () => {
      await setRow({ metadata: null })
      await expect(
        publishPortalCustomisation(
          { before: { logo: { icon: oldIcon } }, logo: { icon: newIcon } },
          ctx()
        )
      ).rejects.toMatchObject({ code: 'ICON_NOT_UPLOADED' })
    })

    it('refuses, as a value, an icon someone changed meanwhile', async () => {
      await setRow({ logoKey: 'logos/theirs.png', faviconKey: 'favicons/theirs.png' })
      const result = await publishPortalCustomisation(
        { before: { logo: { icon: oldIcon } }, logo: { icon: newIcon } },
        ctx()
      )
      expect(result).toMatchObject({
        ok: false,
        code: 'SETTINGS_CHANGED',
        parts: ['logo.icon'],
        current: { logo: { icon: { key: 'logos/theirs.png', faviconKey: 'favicons/theirs.png' } } },
      })
    })

    it.each([
      [{ key: 'header-logos/x.png', faviconKey: 'favicons/x.png' }],
      [{ key: 'logos/x.png', faviconKey: 'logos/x.png' }],
      [{ key: 'logos/../x.png', faviconKey: 'favicons/x.png' }],
    ])('refuses keys outside the icon and favicon uploads: %j', async (icon) => {
      await expect(
        publishPortalCustomisation({ before: { logo: { icon: oldIcon } }, logo: { icon } }, ctx())
      ).rejects.toThrow()
    })
  })

  describe('wide logo', () => {
    // Undo in the editor can bring the old logo back: it stays stored, on the
    // staged list, for the sweep's grace period instead of being deleted.
    it('keeps the replaced object, staged for the sweep, rather than deleting it', async () => {
      const result = await publishPortalCustomisation(
        { before: { logo: loaded.logo }, logo: { wideKey: 'header-logos/new.png' } },
        ctx()
      )
      expect(result).toMatchObject({ ok: true, parts: ['logo.wideKey'] })
      expect(seams.deleted).toEqual([])
      expect(JSON.parse((await read()).metadata!).stagedUploads).toEqual([
        { key: 'header-logos/old.png', at: expect.any(String) },
      ])
    })

    it('publishes the replaced logo again after an undo, within the grace period', async () => {
      await publishPortalCustomisation(
        { before: { logo: loaded.logo }, logo: { wideKey: 'header-logos/new.png' } },
        ctx()
      )
      const back = await publishPortalCustomisation(
        {
          before: { logo: { wideKey: 'header-logos/new.png' } },
          logo: { wideKey: 'header-logos/old.png' },
        },
        ctx()
      )
      expect(back).toMatchObject({ ok: true })
      const row = await read()
      expect(row.headerLogoKey).toBe('header-logos/old.png')
      expect(JSON.parse(row.metadata!).stagedUploads).toEqual([
        { key: 'header-logos/new.png', at: expect.any(String) },
      ])
      expect(seams.deleted).toEqual([])
    })

    it('keeps the previous object when the publish rolls back', async () => {
      seams.failAudit = true
      await expect(
        publishPortalCustomisation(
          { before: { logo: loaded.logo }, logo: { wideKey: 'header-logos/new.png' } },
          ctx()
        )
      ).rejects.toThrow('Audit refused')
      expect(seams.deleted).toEqual([])
      expect((await read()).headerLogoKey).toBe('header-logos/old.png')
    })

    it('keeps the object when the key is unchanged', async () => {
      await publishPortalCustomisation(
        {
          before: { logo: loaded.logo },
          logo: { wideKey: 'header-logos/old.png', headerDisplayMode: 'custom_logo' },
        },
        ctx()
      )
      expect(seams.deleted).toEqual([])
    })

    it('removes the logo when the key is cleared, staging its object for the sweep', async () => {
      await publishPortalCustomisation(
        { before: { logo: loaded.logo }, logo: { wideKey: null } },
        ctx()
      )
      const row = await read()
      expect(row.headerLogoKey).toBeNull()
      expect(seams.deleted).toEqual([])
      expect(JSON.parse(row.metadata!).stagedUploads.map((u: { key: string }) => u.key)).toContain(
        'header-logos/old.png'
      )
    })

    it('publishes a staged upload as the wide logo, shown in place of the name', async () => {
      const result = await publishPortalCustomisation(
        {
          before: { logo: loaded.logo },
          logo: { wideKey: 'header-logos/new.png', headerDisplayMode: 'custom_logo' },
        },
        ctx(brandingOnly)
      )
      expect(result).toMatchObject({
        ok: true,
        parts: ['logo.wideKey', 'logo.headerDisplayMode'],
        published: { logo: { wideKey: 'header-logos/new.png', headerDisplayMode: 'custom_logo' } },
      })
      const row = await read()
      expect(row.headerLogoKey).toBe('header-logos/new.png')
      expect(row.headerDisplayMode).toBe('custom_logo')
    })

    it('takes the published upload off the staged list, keeping other metadata', async () => {
      await publishPortalCustomisation(
        { before: { logo: loaded.logo }, logo: { wideKey: 'header-logos/new.png' } },
        ctx()
      )
      expect(JSON.parse((await read()).metadata!)).toEqual({
        other: { kept: true },
        // The logo it replaced takes its place there, for the sweep.
        stagedUploads: [{ key: 'header-logos/old.png', at: expect.any(String) }],
      })
    })

    it('takes the font files it publishes off the staged list', async () => {
      const font = 'fonts/2026/11/a-brand.woff2'
      await setRow({
        metadata: JSON.stringify({
          other: { kept: true },
          stagedUploads: [
            { key: 'header-logos/new.png', at: new Date().toISOString() },
            { key: font, at: new Date().toISOString() },
          ],
        }),
      })
      await publishPortalCustomisation(
        {
          before: { theme: loaded.theme },
          theme: {
            themeMode: 'user',
            light: storedTheme.light,
            customFont: {
              family: 'Brand Sans',
              fallback: 'inter',
              files: [{ key: font, weight: 400, style: 'normal' }],
            },
          },
        },
        ctx()
      )
      expect(JSON.parse((await read()).metadata!).stagedUploads).toEqual([
        { key: 'header-logos/new.png', at: expect.any(String) },
      ])
    })

    it('stages the font files a publish replaces or removes, for the sweep', async () => {
      const brand = (key: string) => ({
        family: 'Brand Sans',
        fallback: 'inter',
        files: [{ key, weight: 400, style: 'normal' as const }],
      })
      const stored = { themeMode: 'user' as const, customFont: brand('fonts/2026/11/old.woff2') }
      await setRow({
        brandingConfig: JSON.stringify(stored),
        metadata: JSON.stringify({
          stagedUploads: [{ key: 'fonts/2026/11/new.woff2', at: new Date().toISOString() }],
        }),
      })
      await publishPortalCustomisation(
        {
          before: { theme: stored },
          theme: { themeMode: 'user', customFont: brand('fonts/2026/11/new.woff2') },
        },
        ctx()
      )
      expect(JSON.parse((await read()).metadata!).stagedUploads).toEqual([
        { key: 'fonts/2026/11/old.woff2', at: expect.any(String) },
      ])

      await publishPortalCustomisation(
        {
          before: { theme: { themeMode: 'user', customFont: brand('fonts/2026/11/new.woff2') } },
          theme: { themeMode: 'user' },
        },
        ctx()
      )
      expect(
        JSON.parse((await read()).metadata!).stagedUploads.map((u: { key: string }) => u.key)
      ).toEqual(['fonts/2026/11/old.woff2', 'fonts/2026/11/new.woff2'])
      expect(seams.deleted).toEqual([])
    })

    it('refuses a font file the sweep removed, writing nothing', async () => {
      // A draft kept past the sweep: the file is gone, so saving it would
      // load a font that is not there.
      const attempt = publishPortalCustomisation(
        {
          before: { theme: loaded.theme },
          theme: {
            themeMode: 'dark',
            customFont: {
              family: 'Brand Sans',
              fallback: 'inter',
              files: [{ key: 'fonts/2026/11/swept.woff2', weight: 400, style: 'normal' }],
            },
          },
        },
        ctx()
      )
      await expect(attempt).rejects.toMatchObject({
        code: 'FONT_NOT_UPLOADED',
        message: 'Upload the font again, then publish.',
      })
      expect(JSON.parse((await read()).brandingConfig!)).toEqual(storedTheme)
    })

    it('publishes a font already stored without it being staged again', async () => {
      const font = 'fonts/2026/11/kept.woff2'
      const stored = {
        themeMode: 'user' as const,
        light: storedTheme.light,
        customFont: {
          family: 'Brand Sans',
          fallback: 'inter',
          files: [{ key: font, weight: 400, style: 'normal' as const }],
        },
      }
      await setRow({ brandingConfig: JSON.stringify(stored) })
      const result = await publishPortalCustomisation(
        {
          before: { theme: stored },
          theme: { ...stored, themeMode: 'dark' },
        },
        ctx()
      )
      expect(result).toMatchObject({ ok: true, parts: ['theme'] })
    })

    it('refuses a key that is neither staged nor the published one, writing nothing', async () => {
      // A draft kept past the sweep: its upload is gone, so saving the key
      // would show a broken image.
      const attempt = publishPortalCustomisation(
        {
          before: { theme: loaded.theme, logo: loaded.logo },
          theme: { themeMode: 'dark' },
          logo: { wideKey: 'header-logos/swept.png', headerDisplayMode: 'custom_logo' },
        },
        ctx()
      )
      await expect(attempt).rejects.toMatchObject({
        code: 'WIDE_LOGO_NOT_UPLOADED',
        message: 'Upload the wide logo again, then publish.',
      })
      const row = await read()
      expect(row.headerLogoKey).toBe('header-logos/old.png')
      expect(row.headerDisplayMode).toBe('logo_and_name')
      expect(JSON.parse(row.brandingConfig!)).toEqual(storedTheme)
      expect(seams.deleted).toEqual([])
    })

    it('refuses a key outside the header logo uploads', async () => {
      await expect(
        publishPortalCustomisation(
          { before: { logo: loaded.logo }, logo: { wideKey: 'logos/someone-else.png' } },
          ctx()
        )
      ).rejects.toThrow()
      await expect(
        publishPortalCustomisation(
          { before: { logo: loaded.logo }, logo: { wideKey: 'header-logos/../logos/x.png' } },
          ctx()
        )
      ).rejects.toThrow()
      expect((await read()).headerLogoKey).toBe('header-logos/old.png')
    })
  })

  it('records portal.customise.published with the parts changed and no values', async () => {
    await publishPortalCustomisation(
      {
        before: { theme: loaded.theme, customCss: '' },
        theme: { themeMode: 'dark' },
        customCss: '',
      },
      ctx()
    )
    const rows = await audits()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      actorEmail: actor.email,
      metadata: { parts: ['theme'] },
      beforeValue: null,
      afterValue: null,
    })
  })

  it('refuses theme values that would break out of the stylesheet', async () => {
    await expect(
      publishPortalCustomisation(
        {
          before: { theme: loaded.theme },
          theme: { light: { primary: 'red; } body { display: none' } },
        },
        ctx()
      )
    ).rejects.toThrow()
  })
})
