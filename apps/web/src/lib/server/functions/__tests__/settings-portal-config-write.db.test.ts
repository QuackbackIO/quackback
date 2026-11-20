/**
 * The whole portal config saves with settings.manage alone, against a real
 * database: settings.branding, which opens Customise and publishes the
 * portal's tabs and welcome message there, cannot write it. The permission
 * checks are the real ones; only the signed-in teammate is a stand-in.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { settings } from '@/lib/server/db'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

const hoisted = vi.hoisted(() => ({ permissions: [] as string[] }))

vi.mock('@tanstack/react-start', async (original) => ({
  ...(await original<typeof import('@tanstack/react-start')>()),
  // A server function is its handler here, so the test calls it directly and
  // the handler's own checks are what stand between a caller and the save.
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      handler: (fn: (input: { data: unknown }) => Promise<unknown>) => fn,
    }
    return chain
  },
}))
vi.mock('@/lib/server/functions/auth-helpers', async (original) => {
  const real = await original<typeof import('@/lib/server/functions/auth-helpers')>()
  const auth = () => ({
    scope: 'dashboard' as const,
    principal: { id: 'principal_test', role: 'member' },
    permissions: hoisted.permissions,
  })
  return {
    ...real,
    requireAuth: async (options?: { permission?: string }) => {
      if (options?.permission && !hoisted.permissions.includes(options.permission)) {
        throw new Error(`Access denied: Requires permission '${options.permission}'`)
      }
      return auth()
    },
  }
})
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { getPortalConfig } from '@/lib/server/domains/settings/settings.service'
import { updatePortalConfigFn } from '../settings'

const fixture = await createDbTestFixture()
afterAll(fixture.close)

const as = (...permissions: PermissionKey[]) => {
  hoisted.permissions = permissions
}
type Call = (input: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>
const saveConfig = (data: Record<string, unknown>) =>
  (updatePortalConfigFn as unknown as Call)({ data })
const stored = async () => {
  await invalidateSettingsCache()
  return getPortalConfig('fresh')
}

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})
const NAV = { items: [{ id: 'feedback', type: 'feedback' }] }
const NEW_NAV = {
  items: [
    { id: 'roadmap', type: 'roadmap' },
    { id: 'feedback', type: 'feedback', label: 'Ideas' },
  ],
}
const ACCESS = {
  visibility: 'private',
  allowedDomains: ['acme.example'],
  widgetSignIn: true,
  allowedSegmentIds: ['segment_secret'],
}

describe.skipIf(!fixture.available)('saving the whole portal config (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    const [row] = await testDb.select({ id: settings.id }).from(settings).limit(1)
    if (!row) {
      await testDb
        .insert(settings)
        .values({ name: 'Acme', slug: `acme-${createId('user')}`, createdAt: new Date() })
    }
    await testDb.update(settings).set({
      portalConfig: JSON.stringify({
        openSignup: false,
        welcomeCard: { body: doc('Hi') },
        nav: NAV,
        access: ACCESS,
      }),
    })
    await invalidateSettingsCache()
  })
  afterEach(async () => {
    await fixture.rollback()
    await invalidateSettingsCache()
  })

  describe('with settings.branding alone', () => {
    beforeEach(() => as(PERMISSIONS.SETTINGS_BRANDING))

    it.each([
      ['openSignup', { openSignup: true }],
      ['access', { access: { visibility: 'public' } }],
      ['the portal tabs', { nav: NEW_NAV }],
    ])('is refused for %s through the whole portal config save', async (_, data) => {
      await expect(saveConfig(data)).rejects.toThrow(/Access denied/)
      const config = await stored()
      expect(config.nav).toEqual(NAV)
      expect(config.openSignup).toBe(false)
      expect(config.access).toMatchObject(ACCESS)
    })
  })

  describe('with settings.manage', () => {
    beforeEach(() => as(PERMISSIONS.SETTINGS_MANAGE))

    it('saves every field through the whole portal config save', async () => {
      await saveConfig({
        openSignup: true,
        nav: NEW_NAV,
        welcomeCard: { body: doc('Welcome') },
        features: { allowAnonymous: true },
      })
      const config = await stored()
      expect(config.openSignup).toBe(true)
      expect(config.nav).toEqual(NEW_NAV)
      expect(config.welcomeCard?.body).toEqual(doc('Welcome'))
      expect(config.features?.allowAnonymous).toBe(true)
    })
  })

  it('refuses a teammate with neither permission', async () => {
    as(PERMISSIONS.SETTINGS_MODERATION, PERMISSIONS.SETTINGS_CUSTOM_DOMAIN)
    await expect(saveConfig({ nav: NEW_NAV })).rejects.toThrow(/Access denied/)
    expect((await stored()).nav).toEqual(NAV)
  })
})
