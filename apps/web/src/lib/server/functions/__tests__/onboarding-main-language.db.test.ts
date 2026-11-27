/**
 * A new workspace takes its main language from the owner's browser during
 * setup, and the General collection the help center goal seeds is labelled
 * with it. A workspace that already has languages keeps them.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { helpCenterCategories, isNull, principal, settings, user } from '@/lib/server/db'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: (options: { method: string }) => {
    expect(['GET', 'POST']).toContain(options.method)
    let validator: { parse: (input: unknown) => unknown } | undefined
    const builder = {
      validator: (schema: typeof validator) => {
        validator = schema
        return builder
      },
      handler: (handler: (input: { data: unknown }) => unknown) => (input?: { data?: unknown }) =>
        handler({ data: validator ? validator.parse(input?.data) : input?.data }),
    }
    return builder
  },
}))

const sessionState = vi.hoisted(() => ({ current: null as unknown }))
const browser = vi.hoisted(() => ({ acceptLanguage: 'de-DE,de;q=0.9' }))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers({ 'accept-language': browser.acceptLanguage }),
}))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/auth/session', () => ({ getSession: async () => sessionState.current }))
vi.mock('@/lib/server/functions/workspace', () => ({
  getSettings: async () => (await testDb.query.settings.findFirst()) ?? null,
}))
const scheduleOnboardingEmails = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/lib/server/domains/onboarding/onboarding-emails', () => ({
  scheduleOnboardingEmails,
}))
vi.mock('@/lib/server/domains/settings/settings.helpers', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/settings.helpers')>()),
  invalidateSettingsCache: async () => {},
}))

import { saveWorkspaceAndGoalFn } from '../onboarding'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: settings.id }).from(settings).limit(0)
  },
})
describe('setup sets the main language from the owner browser', () => {
  beforeEach(async () => {
    expect(fixture.available).toBe(true)
    await fixture.begin()
    const id = createId('user')
    await testDb
      .insert(user)
      .values({ id, name: 'Acme', email: 'you@example.com', emailVerified: true })
    await testDb.insert(principal).values({
      id: createId('principal'),
      userId: id,
      type: 'user',
      role: 'admin',
      createdAt: new Date(),
    })
    await testDb.delete(settings)
    browser.acceptLanguage = 'de-DE,de;q=0.9'
    sessionState.current = {
      user: { id, name: 'Acme', email: 'you@example.com' },
      session: { scope: 'dashboard' },
    }
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  async function mainLanguage(): Promise<string | undefined> {
    const row = await testDb.query.settings.findFirst()
    return row?.languageConfig ? JSON.parse(row.languageConfig).mainLanguage : undefined
  }

  /** The help center's own record of its main language. */
  async function helpCenterDefault(): Promise<string | undefined> {
    const row = await testDb.query.settings.findFirst()
    return row?.helpCenterConfig ? JSON.parse(row.helpCenterConfig).locales?.default : undefined
  }

  it("stores the owner's browser language on a new workspace, and labels General with it", async () => {
    await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Acme', goals: ['help_center'] } })
    expect(await mainLanguage()).toBe('de')
    expect(await helpCenterDefault()).toBe('de')
    const general = await testDb.query.helpCenterCategories.findFirst({
      where: isNull(helpCenterCategories.deletedAt),
    })
    expect(general?.locale).toBe('de')
  })

  it('fills a provisioned workspace that has no languages yet', async () => {
    await testDb.insert(settings).values({
      name: 'Acme',
      slug: `acme-${createId('workspace')}`,
      createdAt: new Date(),
    })
    browser.acceptLanguage = 'fr-FR'
    await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Acme', goals: ['product_feedback'] } })
    expect(await mainLanguage()).toBe('fr')
    expect(await helpCenterDefault()).toBe('fr')
  })

  it('keeps a provisioned workspace language that is already set', async () => {
    await testDb.insert(settings).values({
      name: 'Acme',
      slug: `acme-${createId('workspace')}`,
      createdAt: new Date(),
      languageConfig: JSON.stringify({ mainLanguage: 'nl', visitorLanguage: 'own' }),
    })
    await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Acme', goals: ['product_feedback'] } })
    expect(await mainLanguage()).toBe('nl')
  })
})
