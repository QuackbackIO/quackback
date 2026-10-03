import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, eq, getSetupState, principal, settings, user } from '@/lib/server/db'
import { DEFAULT_FEATURE_FLAGS } from '@/lib/server/domains/settings/settings.types'

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
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/auth/session', () => ({ getSession: async () => sessionState.current }))
vi.mock('@/lib/server/functions/workspace', () => ({
  getSettings: async () => (await testDb.query.settings.findFirst()) ?? null,
}))
vi.mock('@/lib/server/domains/settings/settings.helpers', () => ({
  invalidateSettingsCache: async () => {},
}))

import { saveWorkspaceAndGoalFn, ensureOnboardingHomeReadyFn } from '../onboarding'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: settings.id }).from(settings).limit(0)
  },
})
describe('wizard goals read and write', () => {
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
    sessionState.current = {
      user: { id, name: 'Acme', email: 'you@example.com' },
      session: { scope: 'dashboard' },
    }
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('persists Support plus Help center, enables both and creates no content', async () => {
    await saveWorkspaceAndGoalFn({
      data: { workspaceName: 'Acme', goals: ['customer_support', 'help_center'] },
    })
    const row = await testDb.query.settings.findFirst()
    expect(getSetupState(row!.setupState)).toMatchObject({
      goals: ['customer_support', 'help_center'],
      useCase: 'customer_support',
    })
    expect(JSON.parse(row!.featureFlags!)).toEqual({
      ...DEFAULT_FEATURE_FLAGS,
      supportInbox: true,
      supportTickets: true,
      helpCenter: true,
    })
    expect(await testDb.query.boards.findMany()).toHaveLength(0)
  })

  it('seeds an empty private feedback board and preserves the reader on a second save', async () => {
    await saveWorkspaceAndGoalFn({
      data: {
        workspaceName: 'Acme',
        goals: ['product_feedback', 'status_page'],
        feedbackPrivate: true,
      },
    })
    const board = await testDb.query.boards.findFirst({ where: eq(boards.slug, 'feedback') })
    expect(board!.access.view).toBe('team')
    expect(await testDb.query.posts.findMany()).toHaveLength(0)
    await saveWorkspaceAndGoalFn({
      data: {
        workspaceName: 'Acme',
        goals: ['product_feedback', 'status_page'],
        feedbackPrivate: true,
      },
    })
    const row = await testDb.query.settings.findFirst()
    expect(getSetupState(row!.setupState)).toMatchObject({
      goals: ['product_feedback', 'status_page'],
      feedbackPrivate: true,
    })
    expect(JSON.parse(row!.featureFlags!).statusPage).toBe(true)
    expect(await testDb.query.boards.findMany()).toHaveLength(1)
  })

  it('reports initial module changes so Home can refresh its navigation context', async () => {
    await testDb.insert(settings).values({
      name: 'Acme',
      slug: 'acme',
      createdAt: new Date(),
      setupState: JSON.stringify({
        version: 2,
        steps: { core: true, workspace: true, startingPoint: null },
        goals: ['customer_support', 'help_center'],
      }),
      featureFlags: JSON.stringify(DEFAULT_FEATURE_FLAGS),
    })
    expect(await ensureOnboardingHomeReadyFn()).toMatchObject({ modulesChanged: true })
    const row = await testDb.query.settings.findFirst()
    expect(JSON.parse(row!.featureFlags!)).toMatchObject({ supportInbox: true, helpCenter: true })
    expect(await ensureOnboardingHomeReadyFn()).toMatchObject({ modulesChanged: false })
    await testDb
      .update(settings)
      .set({ featureFlags: JSON.stringify(DEFAULT_FEATURE_FLAGS) })
      .where(eq(settings.id, row!.id))
    expect(await ensureOnboardingHomeReadyFn()).toMatchObject({ modulesChanged: false })
    expect(JSON.parse((await testDb.query.settings.findFirst())!.featureFlags!)).toEqual(
      DEFAULT_FEATURE_FLAGS
    )
  })

  it('keeps config-managed goals when the wizard saves without them and refuses a change', async () => {
    await testDb.insert(settings).values({
      name: 'Acme',
      slug: 'acme',
      createdAt: new Date(),
      managedFieldPaths: ['workspace.useCase'],
      setupState: JSON.stringify({
        version: 2,
        steps: { core: true, workspace: false, startingPoint: null },
        useCase: 'customer_support',
        goals: ['customer_support', 'help_center'],
      }),
      featureFlags: JSON.stringify(DEFAULT_FEATURE_FLAGS),
    })
    await expect(
      saveWorkspaceAndGoalFn({ data: { workspaceName: 'Acme', goals: ['product_feedback'] } })
    ).rejects.toThrow(/managed/)
    await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Acme' } })
    const row = await testDb.query.settings.findFirst()
    expect(getSetupState(row!.setupState)).toMatchObject({
      goals: ['customer_support', 'help_center'],
      useCase: 'customer_support',
      steps: { workspace: true },
    })
    expect(JSON.parse(row!.featureFlags!)).toMatchObject({ supportInbox: true, helpCenter: true })
    expect(await testDb.query.boards.findMany()).toHaveLength(0)
  })
})
