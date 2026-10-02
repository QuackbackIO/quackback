import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, user } from '@/lib/server/db'
import { PERMISSIONS } from '@/lib/shared/permissions'

const session = vi.hoisted(() => ({ auth: null as unknown, events: [] as unknown[] }))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/auth/session', () => ({ getSession: async () => session.auth }))
vi.mock('@/lib/server/functions/workspace', () => ({
  getSettings: async () => (await testDb.query.settings.findFirst()) ?? null,
}))
vi.mock('@/lib/server/domains/settings/settings.helpers', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/settings.helpers')>()),
  invalidateSettingsCache: async () => {},
}))
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: async (options: { permission: string }) => {
    expect(options.permission).toBe(PERMISSIONS.SETTINGS_MANAGE)
    return { ...(session.auth as object), settings: await testDb.query.settings.findFirst() }
  },
}))
vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: async () => ({ maxBoards: null }),
}))
vi.mock('@/lib/server/plg-events', () => ({
  emitPlgEvent: async (event: unknown) => {
    session.events.push(event)
  },
}))
import { saveWorkspaceAndGoalFn } from '../onboarding'
import { completeStartingPointFn } from '../activation'
const fixture = await createDbTestFixture()
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  const id = createId('user'),
    pid = createId('principal')
  await testDb.insert(user).values({ id, name: 'Acme', email: 'you@example.com' })
  await testDb
    .insert(principal)
    .values({ id: pid, userId: id, type: 'user', role: 'admin', createdAt: new Date() })
  session.auth = {
    user: { id, name: 'Acme', email: 'you@example.com' },
    principal: { id: pid, role: 'admin' },
    session: { scope: 'dashboard' },
  }
})
afterEach(fixture.rollback)
afterAll(fixture.close)
it.each(['help_center', 'status_page'] as const)(
  'keeps the older starting-point action empty for %s',
  async (goal) => {
    await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Acme', goals: [goal] } })
    await completeStartingPointFn({ data: { action: 'complete' } })
    expect(await testDb.query.helpCenterArticles.findMany()).toHaveLength(0)
    expect(await testDb.query.helpCenterCategories.findMany()).toHaveLength(0)
    expect(await testDb.query.boards.findMany()).toHaveLength(0)
  }
)
