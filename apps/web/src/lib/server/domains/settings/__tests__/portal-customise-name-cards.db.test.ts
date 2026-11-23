/**
 * Real-Postgres proof of the parts a publish gained with the holistic brand
 * match: the name in the header (never the workspace's own), the card style, and the headings font, whose uploaded files are
 * checked, kept and swept exactly as the text font's are.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type UserId, type WorkspaceId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, settings, sql, user } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { ALL_PERMISSIONS, PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
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
const everything: PermissionKey[] = [...ALL_PERMISSIONS]
const brandingOnly: PermissionKey[] = [PERMISSIONS.SETTINGS_BRANDING]
const read = async () =>
  (await testDb.select().from(settings).where(eq(settings.id, settingsId)).limit(1))[0]!
const setRow = (values: Partial<typeof settings.$inferInsert>) =>
  testDb.update(settings).set(values).where(eq(settings.id, settingsId))

const storedTheme = { themeMode: 'user', light: { primary: '#111111' } }
const loaded = { theme: storedTheme }
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
    name: 'Acme',
    brandingConfig: JSON.stringify(storedTheme),
    customCss: null,
    tierLimits: null,
    cloudIdentity: null,
    managedFieldPaths: [],
    headerDisplayName: null,
    metadata: JSON.stringify({ stagedUploads: [] }),
  })
})
afterEach(async () => {
  await fixture.rollback()
  invalidateTierLimitsCache()
})
afterAll(() => fixture.close())

describe('the name in the header', () => {
  it('publishes the header name alone, leaving the workspace name as it was', async () => {
    const result = await publishPortalCustomisation(
      { before: { headerName: '' }, headerName: '  Northwind ' },
      ctx()
    )
    expect(result).toMatchObject({
      ok: true,
      parts: ['headerName'],
      published: { headerName: 'Northwind' },
    })
    const row = await read()
    expect(row.headerDisplayName).toBe('Northwind')
    // Emails, sign-in and page titles keep the workspace's own name.
    expect(row.name).toBe('Acme')
  })

  it('needs only the branding permission, as the header name’s own setting does', async () => {
    const result = await publishPortalCustomisation(
      { before: { headerName: '' }, headerName: 'Northwind' },
      ctx(brandingOnly)
    )
    expect(result.ok).toBe(true)
  })

  it('refuses, as a value, a header name someone changed meanwhile', async () => {
    await setRow({ headerDisplayName: 'Acme Feedback' })
    const result = await publishPortalCustomisation(
      { before: { headerName: '' }, headerName: 'Northwind' },
      ctx()
    )
    expect(result).toMatchObject({
      ok: false,
      code: 'SETTINGS_CHANGED',
      parts: ['headerName'],
      current: { headerName: 'Acme Feedback' },
    })
    expect((await read()).headerDisplayName).toBe('Acme Feedback')
  })

  it('publishes where Cloud or a config file names the workspace: that name is not touched', async () => {
    await setRow({
      managedFieldPaths: ['workspace.name'],
      cloudIdentity: { displayName: 'Acme', customDomains: [] } as never,
    })
    const result = await publishPortalCustomisation(
      { before: { headerName: '' }, headerName: 'Northwind' },
      ctx()
    )
    expect(result.ok).toBe(true)
    expect((await read()).name).toBe('Acme')
  })

  it('an empty name clears it, so the header shows the workspace name again', async () => {
    await setRow({ headerDisplayName: 'Northwind' })
    const result = await publishPortalCustomisation(
      { before: { headerName: 'Northwind' }, headerName: '   ' },
      ctx()
    )
    expect(result).toMatchObject({ ok: true, parts: ['headerName'], published: { headerName: '' } })
    expect((await read()).headerDisplayName).toBeNull()
  })

  it('no longer takes a workspace name at all', async () => {
    await expect(
      publishPortalCustomisation({ before: { name: 'Acme' }, name: 'Northwind' } as never, ctx())
    ).rejects.toThrow()
    expect((await read()).name).toBe('Acme')
  })
})

describe('the card style and the headings font', () => {
  const display = (key: string) => ({
    family: 'Northwind Display',
    fallback: 'inter',
    files: [{ key, weight: 600, style: 'normal' as const }],
  })
  const staged = (...keys: string[]) =>
    JSON.stringify({ stagedUploads: keys.map((key) => ({ key, at: new Date().toISOString() })) })
  const stagedKeys = async () =>
    (JSON.parse((await read()).metadata!).stagedUploads as Array<{ key: string }>).map(
      (upload) => upload.key
    )

  it('stores a card style and a listed headings font with the theme', async () => {
    const theme = {
      themeMode: 'user' as const,
      cardStyle: 'shadow' as const,
      light: {
        ...storedTheme.light,
        fontHeading: '"Manrope", ui-sans-serif, system-ui, sans-serif',
      },
    }
    const result = await publishPortalCustomisation(
      { before: { theme: loaded.theme }, theme },
      ctx()
    )
    expect(result).toMatchObject({ ok: true, parts: ['theme'] })
    expect(JSON.parse((await read()).brandingConfig!)).toEqual(theme)
  })

  it('refuses a card style that is not one of the three', async () => {
    await expect(
      publishPortalCustomisation(
        { before: { theme: loaded.theme }, theme: { cardStyle: 'glass' as never } },
        ctx()
      )
    ).rejects.toThrow()
  })

  it('takes an uploaded headings font off the staged list, and stages the one it replaces', async () => {
    await setRow({ metadata: staged('fonts/2026/11/h-new.woff2') })
    const first = {
      themeMode: 'user' as const,
      customHeadingFont: display('fonts/2026/11/h-new.woff2'),
    }
    await publishPortalCustomisation({ before: { theme: loaded.theme }, theme: first }, ctx())
    expect(await stagedKeys()).toEqual([])
    expect(JSON.parse((await read()).brandingConfig!).customHeadingFont).toEqual(
      first.customHeadingFont
    )

    await publishPortalCustomisation(
      { before: { theme: first }, theme: { themeMode: 'user' } },
      ctx()
    )
    expect(await stagedKeys()).toEqual(['fonts/2026/11/h-new.woff2'])
  })

  it('refuses a headings font file the sweep removed, writing nothing', async () => {
    const attempt = publishPortalCustomisation(
      {
        before: { theme: loaded.theme },
        theme: { themeMode: 'dark', customHeadingFont: display('fonts/2026/11/swept.woff2') },
      },
      ctx()
    )
    await expect(attempt).rejects.toMatchObject({ code: 'FONT_NOT_UPLOADED' })
    expect(JSON.parse((await read()).brandingConfig!)).toEqual(storedTheme)
  })

  it('keeps a file both fonts share when only one of them goes', async () => {
    const shared = 'fonts/2026/11/shared.woff2'
    const stored = {
      themeMode: 'user' as const,
      customFont: { ...display(shared), family: 'Brand Sans' },
      customHeadingFont: display(shared),
    }
    await setRow({ brandingConfig: JSON.stringify(stored), metadata: staged() })
    const { customHeadingFont: _gone, ...next } = stored
    await publishPortalCustomisation({ before: { theme: stored }, theme: next }, ctx())
    expect(await stagedKeys()).toEqual([])
  })
})
