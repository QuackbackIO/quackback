/**
 * Two settings reads that pages owned by a narrower permission need, against a
 * real database: the portal page config (Settings > Moderation, the Design tab
 * of Settings > Portal) and the GitHub channel status (Settings > Support >
 * GitHub). Each opens to the page's own permission, and the portal read hands
 * each viewer only the parts of the portal config their permissions read.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { settings } from '@/lib/server/db'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

const hoisted = vi.hoisted(() => ({ permissions: [] as string[] }))

vi.mock('@tanstack/react-start', async (original) => ({
  ...(await original<typeof import('@tanstack/react-start')>()),
  // A server function is its handler here, so the test calls it directly.
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      handler: (fn: () => Promise<unknown>) => fn,
    }
    return chain
  },
}))
// The signed-in teammate; the permission checks themselves are the real ones.
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
import { fetchPortalPageConfigFn } from '../settings'
import { getGitHubChannelStatusFn } from '@/integrations/github/server/functions'

const fixture = await createDbTestFixture()
afterAll(fixture.close)

const as = (...permissions: PermissionKey[]) => {
  hoisted.permissions = permissions
}
const readPortalPage = () => (fetchPortalPageConfigFn as unknown as () => Promise<object>)()
const readGitHubStatus = () =>
  (getGitHubChannelStatusFn as unknown as () => Promise<{ connected: boolean }>)()

const WELCOME = {
  body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }] },
}
const NAV = { items: [{ id: 'feedback', type: 'feedback' }] }
const MODERATION = {
  requireApproval: 'anonymous',
  holdImages: true,
  holdLinks: false,
  emailDecisions: false,
}

describe.skipIf(!fixture.available)('settings reads for narrower permissions (real DB)', () => {
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
        features: { allowAnonymous: true },
        openSignup: false,
        moderationDefault: MODERATION,
        welcomeCard: WELCOME,
        nav: NAV,
        access: {
          visibility: 'private',
          allowedDomains: ['acme.example'],
          widgetSignIn: true,
          allowedSegmentIds: ['segment_secret'],
        },
      }),
    })
    await invalidateSettingsCache()
  })
  afterEach(async () => {
    await fixture.rollback()
    await invalidateSettingsCache()
  })

  describe('the portal page config', () => {
    it('gives settings.moderation the moderation default and nothing else', async () => {
      as(PERMISSIONS.SETTINGS_MODERATION)
      expect(await readPortalPage()).toEqual({ moderationDefault: MODERATION })
    })

    it('gives settings.branding the portal tabs and welcome message and nothing else', async () => {
      as(PERMISSIONS.SETTINGS_BRANDING)
      const config = await readPortalPage()
      expect(Object.keys(config).sort()).toEqual(['nav', 'welcomeCard'])
      expect(config).toMatchObject({ nav: NAV, welcomeCard: { body: WELCOME.body } })
    })

    it('gives settings.manage both, and never who may open the portal or sign up', async () => {
      as(PERMISSIONS.SETTINGS_MANAGE)
      const config = await readPortalPage()
      expect(Object.keys(config).sort()).toEqual(['moderationDefault', 'nav', 'welcomeCard'])
      expect(config).not.toHaveProperty('access')
      expect(config).not.toHaveProperty('openSignup')
    })

    it('refuses a teammate with none of the three', async () => {
      as(PERMISSIONS.SETTINGS_CUSTOM_DOMAIN, PERMISSIONS.BOARD_MANAGE)
      await expect(readPortalPage()).rejects.toThrow(/Access denied/)
    })
  })

  describe('the GitHub channel status', () => {
    it.each([[PERMISSIONS.CHANNEL_ACCOUNT_MANAGE], [PERMISSIONS.SETTINGS_MANAGE]])(
      'opens to %s alone',
      async (permission) => {
        as(permission)
        await expect(readGitHubStatus()).resolves.toHaveProperty('connected')
      }
    )

    it('refuses a teammate with neither', async () => {
      as(PERMISSIONS.INTEGRATION_MANAGE, PERMISSIONS.CONVERSATION_REPLY)
      await expect(readGitHubStatus()).rejects.toThrow(/Access denied/)
    })
  })
})
