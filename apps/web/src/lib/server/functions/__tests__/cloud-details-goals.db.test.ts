import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { getSetupState, settings } from '@/lib/server/db'
import { DEFAULT_FEATURE_FLAGS } from '@/lib/server/domains/settings/settings.types'
import { PERMISSIONS } from '@/lib/shared/permissions'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain: Record<string, unknown> = {}
    chain.validator = () => chain
    chain.handler = (handler: (args: { data?: unknown }) => Promise<unknown>) =>
      Object.assign((args?: { data?: unknown }) => handler(args ?? {}), chain)
    return chain
  },
}))
vi.mock('@tanstack/react-start/server', () => ({ getRequestHeaders: () => ({}) }))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('../auth-helpers', () => ({
  requireAuth: async (options?: { permission?: string }) => {
    expect(options?.permission).toBe(PERMISSIONS.SETTINGS_MANAGE)
    return { user: { id: 'user_caller' } }
  },
}))
vi.mock('@/lib/server/domains/settings/settings.helpers', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/settings.helpers')>()),
  invalidateSettingsCache: async () => {},
}))

const { markCloudWorkspaceDetailsSeenFn } = await import('../cloud-identity')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ cloudIdentity: settings.cloudIdentity }).from(settings).limit(0)
  },
})

const IDENTITY = {
  version: 1,
  displayName: 'Acme',
  canonicalOrigin: 'https://acme.quackback.example',
  platformHostname: 'acme.quackback.example',
  customDomains: [],
  updatedAt: '2026-10-01T09:00:00.000Z',
}

async function workspace(intent: Record<string, unknown>) {
  await testDb.delete(settings)
  await testDb.insert(settings).values({
    name: 'Acme',
    slug: 'acme',
    createdAt: new Date(),
    cloudIdentity: IDENTITY,
    featureFlags: JSON.stringify(DEFAULT_FEATURE_FLAGS),
    setupState: JSON.stringify({
      version: 2,
      steps: { core: true, workspace: true, startingPoint: null },
      ...intent,
    }),
  })
}

describe('finishing the workspace details step applies every goal', () => {
  beforeEach(async () => {
    expect(fixture.available).toBe(true)
    await fixture.begin()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('turns on the modules of every chosen goal and creates no content', async () => {
    await workspace({ goals: ['customer_support', 'help_center', 'status_page'] })
    await markCloudWorkspaceDetailsSeenFn()
    const row = await testDb.query.settings.findFirst()
    expect(JSON.parse(row!.featureFlags!)).toEqual({
      ...DEFAULT_FEATURE_FLAGS,
      supportInbox: true,
      supportTickets: true,
      helpCenter: true,
      statusPage: true,
    })
    expect(getSetupState(row!.setupState)).toMatchObject({
      goals: ['customer_support', 'help_center', 'status_page'],
      useCase: 'customer_support',
      steps: { startingPoint: { source: 'wizard', outcome: 'customer_support' } },
    })
    expect(await testDb.query.boards.findMany()).toHaveLength(0)
  })

  it('prepares the feedback board with the chosen audience', async () => {
    await workspace({ goals: ['product_feedback', 'customer_support'], feedbackPrivate: true })
    await markCloudWorkspaceDetailsSeenFn()
    const boards = await testDb.query.boards.findMany()
    expect(boards).toHaveLength(1)
    expect(boards[0]!.slug).toBe('feedback')
    expect(boards[0]!.access.view).toBe('team')
    const row = await testDb.query.settings.findFirst()
    expect(JSON.parse(row!.featureFlags!)).toMatchObject({ supportInbox: true })
  })
})
