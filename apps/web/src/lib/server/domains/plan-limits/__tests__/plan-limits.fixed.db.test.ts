/**
 * The Plan limits page's fixed rows against a real settings row: the caps
 * over at first detection are stored with the grace, survive a chooser's
 * write, and a cap fixed through its own service shows as fixed at once,
 * while what is left stays over with the same deadline. The page and the
 * banner's summary read the same rows.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createId,
  type BoardId,
  type PrincipalId,
  type UserId,
  type WorkspaceId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  eq,
  isNull,
  posts,
  principal,
  settings,
  statusComponents,
  user,
} from '@/lib/server/db'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'
import { PERMISSIONS } from '@/lib/shared/permissions'

const memo = vi.hoisted(() => ({ cache: new Map<string, unknown>() }))

// The application cache, kept in memory: its kv rows are shared by every test
// file on the database.
vi.mock('@/lib/server/cache', async (original) => ({
  ...(await original<typeof import('@/lib/server/cache')>()),
  cacheGet: async (key: string) =>
    memo.cache.has(key) ? structuredClone(memo.cache.get(key)) : null,
  cacheSet: async (key: string, value: unknown) => {
    memo.cache.set(key, structuredClone(value))
  },
  cacheDel: async (...keys: string[]) => {
    for (const key of keys) memo.cache.delete(key)
  },
}))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { invalidateTierLimitsCache } from '@/lib/server/domains/settings/tier-limits.service'
import { deleteStatusComponent } from '@/lib/server/domains/status/status.components'
import { getPlanLimits, invalidatePlanLimits } from '../plan-limits.service'
import { setKeptBoard } from '../plan-limits.choosers'
import { planLimitsPage } from '../plan-limits.page'
import { planBillingOn } from './plan-billing'

const fixture = await createDbTestFixture()
afterAll(fixture.close)

let settingsId: WorkspaceId
let ownerId: PrincipalId

async function ensureSettings(): Promise<WorkspaceId> {
  const [row] = await testDb.select({ id: settings.id }).from(settings).limit(1)
  if (row) return row.id
  const [created] = await testDb
    .insert(settings)
    .values({ name: 'Acme', slug: `acme-${createId('user')}`, createdAt: new Date() })
    .returning({ id: settings.id })
  return created!.id
}

async function addBoard(name: string, postCount: number): Promise<BoardId> {
  const id = createId('board') as BoardId
  await testDb.insert(boards).values({ id, name, slug: String(id) })
  for (let i = 0; i < postCount; i++) {
    await testDb
      .insert(posts)
      .values({ boardId: id, title: `Acme ${i}`, content: '', principalId: ownerId })
  }
  return id
}

async function storedState(): Promise<Record<string, unknown> | null> {
  const [row] = await testDb
    .select({ state: settings.planLimitsState })
    .from(settings)
    .where(eq(settings.id, settingsId))
  return (row?.state as Record<string, unknown> | null) ?? null
}

/** Drops every cached copy, as a fresh process would read it. */
async function freshRead() {
  memo.cache.clear()
  invalidateTierLimitsCache()
  await invalidateSettingsCache()
  await invalidatePlanLimits()
  return getPlanLimits()
}

describe.skipIf(!fixture.available)('plan limits fixed rows (real DB)', () => {
  let small: BoardId
  let component: string

  beforeEach(async () => {
    await fixture.begin()
    memo.cache.clear()
    settingsId = await ensureSettings()
    await testDb.update(boards).set({ deletedAt: new Date() }).where(isNull(boards.deletedAt))
    await testDb.delete(statusComponents)
    const uid = createId('user') as UserId
    ownerId = createId('principal') as PrincipalId
    await testDb.insert(user).values({ id: uid, name: 'Acme Owner', email: `${uid}@example.com` })
    await testDb
      .insert(principal)
      .values({ id: ownerId, userId: uid, role: 'admin', type: 'user', createdAt: new Date(0) })
    small = await addBoard('Acme small', 1)
    await addBoard('Acme big', 3)
    const [row] = await testDb
      .insert(statusComponents)
      .values({ name: 'Acme API' })
      .returning({ id: statusComponents.id })
    component = row!.id
    await testDb
      .update(settings)
      .set({
        planLimitsState: null,
        tierLimits: JSON.stringify({ ...OSS_TIER_LIMITS, maxBoards: 1, maxStatusComponents: 0 }),
        cloud: planBillingOn() as never,
      })
      .where(eq(settings.id, settingsId))
  })
  afterEach(async () => {
    await invalidatePlanLimits()
    await fixture.rollback()
  })

  it('stores the caps over at first detection, and keeps them through a chooser write', async () => {
    const first = await freshRead()
    expect(first.phase).toBe('grace')
    expect((await storedState())?.overKeys).toEqual(['maxBoards', 'maxStatusComponents'])

    expect(await setKeptBoard(small)).toEqual({ ok: true })
    const stored = await storedState()
    expect(stored?.keptBoardId).toBe(small)
    expect(stored?.overKeys).toEqual(['maxBoards', 'maxStatusComponents'])
    expect(stored?.graceEndsAt).toBe(first.graceEndsAt)
    expect((await freshRead()).keptBoardId).toBe(small)
  })

  it('shows a cap fixed through its service as fixed at once, the rest still over', async () => {
    const first = await freshRead()
    await deleteStatusComponent(component as never)
    const limits = await getPlanLimits()
    expect(limits.issues.map((issue) => issue.key)).toEqual(['maxBoards'])
    expect(limits.fixedIssues).toEqual([{ key: 'maxStatusComponents', used: 0, cap: 0 }])
    expect(limits.graceEndsAt).toBe(first.graceEndsAt)

    // A fresh process reads the same from the stored row.
    const again = await freshRead()
    expect(again.fixedIssues).toEqual([{ key: 'maxStatusComponents', used: 0, cap: 0 }])

    // The page and the banner's summary both carry it, for any teammate.
    const page = planLimitsPage(again, {}, [PERMISSIONS.MEMBER_VIEW])
    expect(page.fixedIssues).toEqual([{ key: 'maxStatusComponents', used: 0, cap: 0 }])
    expect(page.canManageBilling).toBe(false)
  })
})
