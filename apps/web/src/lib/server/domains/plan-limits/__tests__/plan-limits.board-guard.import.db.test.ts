/**
 * CSV import against read-only boards, real database: the cases where the row
 * guard alone is not enough. A re-import aimed at an open board must still
 * leave a post on a read-only board alone, and an import aimed at a board that
 * does not exist yet must not create it while boards are read-only.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type BoardId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, eq, inArray, isNull, posts, principal, settings, user } from '@/lib/server/db'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { invalidateTierLimitsCache } from '@/lib/server/domains/settings/tier-limits.service'
import { processBatch } from '@/lib/server/domains/import/import-service'
import { ImportUserResolver } from '@/lib/server/domains/import/user-resolver'
import { getPlanLimits, invalidatePlanLimits } from '../plan-limits.service'
import { BOARD_READ_ONLY_MESSAGE } from '../plan-limits.board-guard'

const fixture = await createDbTestFixture()
afterAll(fixture.close)
const DAY = 24 * 60 * 60 * 1000

let openBoard: BoardId
let closedBoard: BoardId

async function configure(planLimits: boolean) {
  await testDb.update(settings).set({
    featureFlags: JSON.stringify({ feedback: true, planLimits }),
    tierLimits: JSON.stringify({ ...OSS_TIER_LIMITS, maxBoards: 1 }),
  })
  invalidateTierLimitsCache()
  await invalidateSettingsCache()
  await invalidatePlanLimits()
}

async function enforce() {
  await configure(true)
  await getPlanLimits()
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
  expect((await getPlanLimits()).phase).toBe('enforced')
}

async function addBoard(name: string, postCount: number, createdAt: Date, ownerId: PrincipalId) {
  const id = createId('board') as BoardId
  await testDb.insert(boards).values({ id, name, slug: String(id), createdAt })
  for (let i = 0; i < postCount; i++) {
    await testDb
      .insert(posts)
      .values({ boardId: id, title: `${name} ${i}`, content: '', principalId: ownerId })
  }
  return id
}

describe.skipIf(!fixture.available)('import and read-only boards (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.useRealTimers()
    const [row] = await testDb.select({ id: settings.id }).from(settings).limit(1)
    if (!row) {
      await testDb
        .insert(settings)
        .values({ name: 'Acme', slug: `acme-${createId('user')}`, createdAt: new Date() })
    }
    await testDb.update(settings).set({ planLimitsState: null })
    await testDb.update(boards).set({ deletedAt: new Date() }).where(isNull(boards.deletedAt))
    await testDb
      .update(principal)
      .set({ role: 'user' })
      .where(inArray(principal.role, ['admin', 'member']))
    const ownerUser = createId('user') as UserId
    const ownerId = createId('principal') as PrincipalId
    await testDb
      .insert(user)
      .values({ id: ownerUser, name: 'Acme Owner', email: `${ownerUser}@example.com` })
    await testDb.insert(principal).values({
      id: ownerId,
      userId: ownerUser,
      role: 'admin',
      type: 'user',
      createdAt: new Date(),
    })
    openBoard = await addBoard('Acme open', 3, new Date('2026-02-01T00:00:00.000Z'), ownerId)
    closedBoard = await addBoard('Acme closed', 1, new Date('2026-01-01T00:00:00.000Z'), ownerId)
  })
  afterEach(async () => {
    vi.useRealTimers()
    await invalidatePlanLimits()
    await fixture.rollback()
  })

  it('leaves a post on a read-only board alone when a re-import aims its row at the open board', async () => {
    await configure(false)
    const row = {
      title: 'Acme first',
      content: 'x',
      author_name: 'Acme Fan',
      board: closedBoard,
      source_id: 'src-1',
    }
    await processBatch([row], openBoard, 0, new ImportUserResolver())
    await enforce()
    const voter = { email: 'reimport-voter@example.com', name: 'Acme Voter' }
    const again = await processBatch(
      [{ ...row, title: 'Acme changed', board: openBoard }],
      openBoard,
      0,
      new ImportUserResolver(),
      null,
      { 'src-1': [voter] }
    )
    expect(again).toMatchObject({ updated: 0, imported: 0 })
    expect(again.errors.map((e) => e.message)).toEqual([BOARD_READ_ONLY_MESSAGE])
    const titles = await testDb
      .select({ title: posts.title })
      .from(posts)
      .where(eq(posts.boardId, closedBoard))
    expect(titles.map((p) => p.title)).toContain('Acme first')
    expect(titles.map((p) => p.title)).not.toContain('Acme changed')
    // A refused row creates no one to vote on it.
    expect(await testDb.select().from(user).where(eq(user.email, voter.email))).toHaveLength(0)
  })

  it('creates no board for a row aimed at a new board while boards are read-only', async () => {
    await enforce()
    const result = await processBatch(
      [{ title: 'Acme new', content: 'x', author_name: 'Acme Fan', board: 'Acme Brand New' }],
      openBoard,
      0,
      new ImportUserResolver()
    )
    expect(result.imported).toBe(0)
    expect(result.errors.map((e) => e.message)).toEqual([BOARD_READ_ONLY_MESSAGE])
    const created = await testDb
      .select({ id: boards.id })
      .from(boards)
      .where(eq(boards.name, 'Acme Brand New'))
    expect(created).toHaveLength(0)
  })

  it('creates the new board and imports the row with the rules off', async () => {
    await configure(false)
    const result = await processBatch(
      [{ title: 'Acme new', content: 'x', author_name: 'Acme Fan', board: 'Acme Brand New' }],
      openBoard,
      0,
      new ImportUserResolver()
    )
    expect(result).toMatchObject({ imported: 1, errors: [] })
  })
})
