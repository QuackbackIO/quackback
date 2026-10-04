import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  eq,
  getSetupState,
  helpCenterCategories,
  principal,
  settings,
  statusComponents,
  user,
} from '@/lib/server/db'
import {
  DEFAULT_FEATURE_FLAGS,
  workspaceAllowsAnonymous,
} from '@/lib/server/domains/settings/settings.types'
import { resolveStatusSettings } from '@/lib/server/domains/settings/settings.status'
import { isStatusPagePublished } from '@/lib/shared/status-settings'

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
vi.mock('@/lib/server/domains/settings/settings.helpers', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/settings.helpers')>()),
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

  it('persists Support plus Help center, enables both without Changelog and creates no board', async () => {
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
      changelog: false,
      supportInbox: true,
      supportTickets: true,
      helpCenter: true,
      copilotHome: true,
    })
    expect(await testDb.query.boards.findMany()).toHaveLength(0)
    // Turning Support on through the one flag write also opens the portal surface.
    expect(JSON.parse(row!.portalConfig!).support.enabled).toBe(true)
  })

  it('keeps the Messenger idea tab only when Feedback is one of the goals', async () => {
    await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Acme', goals: ['customer_support'] } })
    let row = await testDb.query.settings.findFirst()
    expect(JSON.parse(row!.widgetConfig!).tabs).toMatchObject({ feedback: false, messenger: true })
    await testDb.delete(settings)
    await saveWorkspaceAndGoalFn({
      data: { workspaceName: 'Acme', goals: ['customer_support', 'product_feedback'] },
    })
    row = await testDb.query.settings.findFirst()
    expect(JSON.parse(row!.widgetConfig!).tabs).toMatchObject({ feedback: true, messenger: true })
  })

  it('keeps Changelog on only when Feedback is one of the goals', async () => {
    await saveWorkspaceAndGoalFn({
      data: { workspaceName: 'Acme', goals: ['product_feedback', 'help_center'] },
    })
    const row = await testDb.query.settings.findFirst()
    expect(JSON.parse(row!.featureFlags!).changelog).toBe(true)
  })

  it('publishes the status page with one service named after the workspace', async () => {
    await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Acme', goals: ['status_page'] } })
    let row = await testDb.query.settings.findFirst()
    const flags = JSON.parse(row!.featureFlags!)
    expect(flags.statusPage).toBe(true)
    expect(isStatusPagePublished(flags, resolveStatusSettings(row!.metadata))).toBe(true)
    const services = await testDb.query.statusComponents.findMany()
    expect(services.map((service) => [service.name, service.status])).toEqual([
      ['Acme', 'operational'],
    ])
    await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Acme', goals: ['status_page'] } })
    row = await testDb.query.settings.findFirst()
    expect(await testDb.query.statusComponents.findMany()).toHaveLength(1)
  })

  it('seeds one General help category so the first article has a home', async () => {
    await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Acme', goals: ['help_center'] } })
    await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Acme', goals: ['help_center'] } })
    const categories = await testDb.query.helpCenterCategories.findMany()
    expect(categories.map((category) => [category.name, category.slug, category.isPublic])).toEqual(
      [['General', 'general', true]]
    )
  })

  it('never seeds a category or a service for goals that do not need them', async () => {
    await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Acme', goals: ['product_feedback'] } })
    expect(await testDb.select().from(helpCenterCategories)).toHaveLength(0)
    expect(await testDb.select().from(statusComponents)).toHaveLength(0)
  })

  it('publishes an operator-provisioned status page that already carried the flag', async () => {
    await testDb.insert(settings).values({
      name: 'Acme',
      slug: 'acme',
      createdAt: new Date(),
      setupState: JSON.stringify({
        version: 2,
        steps: { core: true, workspace: true, startingPoint: null },
        goals: ['status_page'],
        activationHandoffSeenAt: new Date().toISOString(),
      }),
      featureFlags: JSON.stringify({ ...DEFAULT_FEATURE_FLAGS, statusPage: true }),
    })
    await ensureOnboardingHomeReadyFn()
    const row = await testDb.query.settings.findFirst()
    expect(resolveStatusSettings(row!.metadata).enabled).toBe(true)
    expect(await testDb.query.statusComponents.findMany()).toHaveLength(1)
  })

  it('leaves a status page the workspace saved as unpublished alone', async () => {
    await testDb.insert(settings).values({
      name: 'Acme',
      slug: 'acme',
      createdAt: new Date(),
      metadata: JSON.stringify({ statusSettings: { enabled: false } }),
      setupState: JSON.stringify({
        version: 2,
        steps: { core: true, workspace: true, startingPoint: null },
        goals: ['status_page'],
        activationHandoffSeenAt: new Date().toISOString(),
      }),
      featureFlags: JSON.stringify({ ...DEFAULT_FEATURE_FLAGS, statusPage: true }),
    })
    await ensureOnboardingHomeReadyFn()
    const row = await testDb.query.settings.findFirst()
    expect(resolveStatusSettings(row!.metadata).enabled).toBe(false)
  })

  it('seeds one empty board anyone can post on, even when an old client asks for private', async () => {
    await saveWorkspaceAndGoalFn({
      data: {
        workspaceName: 'Acme',
        goals: ['product_feedback', 'status_page'],
        feedbackPrivate: true,
      },
    })
    const board = await testDb.query.boards.findFirst({ where: eq(boards.slug, 'feedback') })
    expect(board!.access).toMatchObject({
      view: 'anonymous',
      vote: 'anonymous',
      comment: 'anonymous',
      submit: 'anonymous',
    })
    expect(await testDb.query.posts.findMany()).toHaveLength(0)
    await saveWorkspaceAndGoalFn({
      data: { workspaceName: 'Acme', goals: ['product_feedback', 'status_page'] },
    })
    const row = await testDb.query.settings.findFirst()
    expect(getSetupState(row!.setupState)).toMatchObject({
      goals: ['product_feedback', 'status_page'],
    })
    expect(getSetupState(row!.setupState)!.feedbackPrivate ?? false).toBe(false)
    expect(JSON.parse(row!.featureFlags!).statusPage).toBe(true)
    expect(await testDb.query.boards.findMany()).toHaveLength(1)
  })

  it('keeps an existing private workspace private when it saves the step again', async () => {
    await testDb.insert(settings).values({
      name: 'Acme',
      slug: 'acme',
      createdAt: new Date(),
      setupState: JSON.stringify({
        version: 2,
        steps: { core: true, workspace: true, startingPoint: null },
        goals: ['product_feedback'],
        feedbackPrivate: true,
      }),
      featureFlags: JSON.stringify(DEFAULT_FEATURE_FLAGS),
    })
    await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Acme', goals: ['product_feedback'] } })
    const row = await testDb.query.settings.findFirst()
    expect(getSetupState(row!.setupState)!.feedbackPrivate).toBe(true)
    const board = await testDb.query.boards.findFirst({ where: eq(boards.slug, 'feedback') })
    expect(board!.access.view).toBe('team')
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

  // An operator creates the row bare (no flags) and stamps the goals; no wizard runs.
  const operatorRow = (createdAt: Date, featureFlags?: string) => ({
    name: 'Acme',
    slug: 'acme',
    createdAt,
    featureFlags,
    setupState: JSON.stringify({
      version: 2,
      steps: { core: true, workspace: true, startingPoint: null },
      goals: ['product_feedback'],
    }),
  })

  it('turns Copilot on Home on for a new workspace an operator provisioned', async () => {
    await testDb.insert(settings).values(operatorRow(new Date()))
    await ensureOnboardingHomeReadyFn()
    const row = await testDb.query.settings.findFirst()
    expect(JSON.parse(row!.featureFlags!)).toMatchObject({ copilotHome: true })
  })

  it('never turns Copilot on Home on for an established workspace or over a saved choice', async () => {
    const yearAgo = new Date(Date.now() - 365 * 86_400_000)
    await testDb.insert(settings).values(operatorRow(yearAgo))
    await ensureOnboardingHomeReadyFn()
    let row = await testDb.query.settings.findFirst()
    expect(JSON.parse(row!.featureFlags ?? '{}').copilotHome ?? false).toBe(false)

    await testDb.delete(settings)
    await testDb
      .insert(settings)
      .values(operatorRow(new Date(), JSON.stringify({ copilotHome: false })))
    await ensureOnboardingHomeReadyFn()
    row = await testDb.query.settings.findFirst()
    expect(JSON.parse(row!.featureFlags!).copilotHome).toBe(false)
  })

  // A provisioner stores only its own auth keys; the anonymous switch is unset.
  const provisionedPortal = JSON.stringify({ oauth: { email: true }, openSignup: true })
  const operatorRowWith = (createdAt: Date, portalConfig: string, goals = ['product_feedback']) => ({
    ...operatorRow(createdAt),
    portalConfig,
    setupState: JSON.stringify({
      version: 2,
      steps: { core: true, workspace: true, startingPoint: null },
      goals,
    }),
  })

  it('opens the workspace to visitors without an account for a new Feedback workspace', async () => {
    await testDb.insert(settings).values(operatorRowWith(new Date(), provisionedPortal))
    await ensureOnboardingHomeReadyFn()
    const row = await testDb.query.settings.findFirst()
    expect(workspaceAllowsAnonymous(row!.portalConfig)).toBe(true)
    // The provisioner's own keys survive.
    expect(JSON.parse(row!.portalConfig!)).toMatchObject({
      oauth: { email: true },
      openSignup: true,
    })
  })

  it('keeps a stored choice to turn visitors without an account off', async () => {
    const closed = JSON.stringify({ openSignup: true, features: { allowAnonymous: false } })
    await testDb.insert(settings).values(operatorRowWith(new Date(), closed))
    await ensureOnboardingHomeReadyFn()
    const row = await testDb.query.settings.findFirst()
    expect(workspaceAllowsAnonymous(row!.portalConfig)).toBe(false)
  })

  it('never opens an established workspace or one without the Feedback goal', async () => {
    const yearAgo = new Date(Date.now() - 365 * 86_400_000)
    await testDb.insert(settings).values(operatorRowWith(yearAgo, provisionedPortal))
    await ensureOnboardingHomeReadyFn()
    let row = await testDb.query.settings.findFirst()
    expect(workspaceAllowsAnonymous(row!.portalConfig)).toBe(false)

    await testDb.delete(settings)
    await testDb
      .insert(settings)
      .values(operatorRowWith(new Date(), provisionedPortal, ['customer_support']))
    await ensureOnboardingHomeReadyFn()
    row = await testDb.query.settings.findFirst()
    expect(workspaceAllowsAnonymous(row!.portalConfig)).toBe(false)
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
