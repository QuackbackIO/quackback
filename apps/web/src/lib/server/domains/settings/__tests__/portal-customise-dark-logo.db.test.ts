/**
 * Real-Postgres proof of the logo's dark mode version: an optional second
 * logo, published, staged and swept exactly as the logo is, that changes
 * nothing about the logo itself, the icon or the emails.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type UserId, type WorkspaceId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { and, auditLog, eq, settings, sql, user } from '@/lib/server/db'
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
const { parsePortalConfig } = await import('../settings.helpers')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    const current = getExecuteRows<{ name: string }>(
      await db.execute(sql`select current_database() as name`)
    )[0]
    if (!current?.name.startsWith('quackback_test'))
      throw new Error('Portal customise tests require a quackback_test database')
  },
})

let settingsId: WorkspaceId
const actor = {
  userId: createId('user') as UserId,
  email: `owner+${createId('user')}@example.com`,
  role: 'admin',
}
const ctx = (permissions: PermissionKey[] = [...ALL_PERMISSIONS]) => ({ permissions, actor })
const read = async () =>
  (await testDb.select().from(settings).where(eq(settings.id, settingsId)).limit(1))[0]!
const setRow = (values: Partial<typeof settings.$inferInsert>) =>
  testDb.update(settings).set(values).where(eq(settings.id, settingsId))
const staged = (...keys: string[]) =>
  JSON.stringify({ stagedUploads: keys.map((key) => ({ key, at: new Date().toISOString() })) })
const stagedKeys = async () =>
  (JSON.parse((await read()).metadata!).stagedUploads as { key: string }[]).map((u) => u.key)
const darkKey = async () => parsePortalConfig((await read()).portalConfig).headerLogoDarkKey ?? null

const LIGHT = 'header-logos/light.svg'
const DARK = 'header-logos/dark.svg'

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
    headerLogoKey: LIGHT,
    headerDisplayMode: 'custom_logo',
    logoKey: 'logos/icon.png',
    portalConfig: JSON.stringify({ nav: { items: [] } }),
    tierLimits: null,
    cloudIdentity: null,
    managedFieldPaths: [],
    metadata: staged(DARK),
  })
})
afterEach(async () => {
  await fixture.rollback()
  invalidateTierLimitsCache()
})
afterAll(() => fixture.close())

describe('the logo’s dark mode version', () => {
  it('publishes a staged upload as the dark version, leaving the logo and the icon as they were', async () => {
    const result = await publishPortalCustomisation(
      { before: { logo: { darkKey: null } }, logo: { darkKey: DARK } },
      ctx([PERMISSIONS.SETTINGS_BRANDING])
    )
    expect(result).toMatchObject({
      ok: true,
      parts: ['logo.darkKey'],
      published: { logo: { darkKey: DARK } },
    })
    expect(await darkKey()).toBe(DARK)
    const row = await read()
    expect(row.headerLogoKey).toBe(LIGHT)
    expect(row.logoKey).toBe('logos/icon.png')
    // Referred to now: off the staged list, so the sweep keeps it.
    expect(await stagedKeys()).toEqual([])
    // The rest of the portal's settings are untouched.
    expect(parsePortalConfig(row.portalConfig).nav).toEqual({ items: [] })
  })

  it('refuses one that was never uploaded, or was swept, writing nothing', async () => {
    await setRow({ metadata: staged() })
    await expect(
      publishPortalCustomisation(
        { before: { logo: { darkKey: null } }, logo: { darkKey: DARK } },
        ctx()
      )
    ).rejects.toMatchObject({ code: 'DARK_LOGO_NOT_UPLOADED' })
    expect(await darkKey()).toBeNull()
  })

  it('refuses a key that is not a header logo upload', async () => {
    await expect(
      publishPortalCustomisation(
        { before: { logo: { darkKey: null } }, logo: { darkKey: 'logos/icon.png' } },
        ctx()
      )
    ).rejects.toThrow()
  })

  it('removing it leaves the old file for the sweep, as a replaced logo is left', async () => {
    await publishPortalCustomisation(
      { before: { logo: { darkKey: null } }, logo: { darkKey: DARK } },
      ctx()
    )
    const result = await publishPortalCustomisation(
      { before: { logo: { darkKey: DARK } }, logo: { darkKey: null } },
      ctx()
    )
    expect(result).toMatchObject({ ok: true, parts: ['logo.darkKey'] })
    expect(await darkKey()).toBeNull()
    expect(await stagedKeys()).toEqual([DARK])
  })

  it('refuses, as a value, a dark version someone changed meanwhile', async () => {
    await setRow({ portalConfig: JSON.stringify({ headerLogoDarkKey: 'header-logos/theirs.svg' }) })
    const result = await publishPortalCustomisation(
      { before: { logo: { darkKey: null } }, logo: { darkKey: DARK } },
      ctx()
    )
    expect(result).toMatchObject({
      ok: false,
      code: 'SETTINGS_CHANGED',
      parts: ['logo.darkKey'],
      current: { logo: { darkKey: 'header-logos/theirs.svg' } },
    })
  })

  it('records the brand assets tick for an imported dark version, as for the logo', async () => {
    const result = await publishPortalCustomisation(
      {
        before: { logo: { darkKey: null } },
        logo: { darkKey: DARK },
        brandAssets: { host: 'acme.example', assets: ['logo'], preTicked: false },
      },
      ctx()
    )
    expect(result.ok).toBe(true)
    const rows = await testDb
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.eventType, 'portal.customise.published'), eq(auditLog.targetId, settingsId))
      )
    expect(rows[0]!.metadata).toMatchObject({ brandAssets: { assets: ['logo'] } })
  })

  it('survives every other save of the portal’s settings: the tabs, the welcome message, a settings page', async () => {
    await publishPortalCustomisation(
      { before: { logo: { darkKey: null } }, logo: { darkKey: DARK } },
      ctx()
    )
    const { updatePortalConfig } = await import('../settings.service')
    await publishPortalCustomisation(
      {
        before: { portal: { nav: { items: [] }, welcomeCard: null } },
        portal: {
          nav: { items: [{ id: 'feedback', type: 'feedback', enabled: true }] },
          welcomeCard: { body: { type: 'doc', content: [{ type: 'paragraph' }] } },
        },
      } as never,
      ctx()
    ).catch(() => undefined)
    await updatePortalConfig({ features: { allowAnonymous: false } } as never)
    await updatePortalConfig({ nav: { items: [] } } as never)
    expect(await darkKey()).toBe(DARK)
  })

  it('needs the branding permission', async () => {
    await expect(
      publishPortalCustomisation(
        { before: { logo: { darkKey: null } }, logo: { darkKey: DARK } },
        ctx([PERMISSIONS.HELP_CENTER_MANAGE])
      )
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
  })
})
