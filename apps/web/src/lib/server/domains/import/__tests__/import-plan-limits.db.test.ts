/**
 * Real-DB coverage for plan caps on the CSV import pipeline: a run that would
 * create more boards or posts than the plan allows is refused before anything
 * is written, with an error that says how many fit.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type BoardId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, posts, principal, user, sql } from '@/lib/server/db'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn(),
}))

import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { processImport } from '../import-service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: boards.id }).from(boards).limit(0)
    await db.select({ id: posts.id }).from(posts).limit(0)
  },
})

const suffix = () => Math.random().toString(36).slice(2, 8)

function csv(rows: { title: string; board?: string }[]): string {
  const lines = ['title,content,board,author_name']
  for (const r of rows) lines.push(`${r.title},body,${r.board ?? ''},Alice`)
  return Buffer.from(lines.join('\n')).toString('base64')
}

async function count(table: typeof boards | typeof posts): Promise<number> {
  const [row] = await testDb.select({ n: sql<number>`count(*)::int` }).from(table)
  return row?.n ?? 0
}

async function seedBoard(): Promise<BoardId> {
  const id = createId('board') as BoardId
  await testDb.insert(boards).values({ id, name: `B ${suffix()}`, slug: `b-${suffix()}` })
  return id
}

async function runImport(boardId: BoardId, rows: { title: string; board?: string }[]) {
  const userId = createId('user')
  const principalId = createId('principal') as PrincipalId
  await testDb
    .insert(user)
    .values({ id: userId, name: 'Importer', email: `i-${suffix()}@example.com` })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'admin',
    type: 'user',
    displayName: 'Importer',
    createdAt: new Date(),
  })
  return processImport({
    boardId,
    csvContent: csv(rows),
    totalRows: rows.length,
    initiatedByPrincipalId: principalId,
  })
}

describe.skipIf(!fixture.available)('import plan caps', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.mocked(getTierLimits).mockResolvedValue(OSS_TIER_LIMITS)
  })
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())

  it('imports everything when limits are unlimited', async () => {
    const boardId = await seedBoard()
    const result = await runImport(boardId, [{ title: 'a' }, { title: 'b' }, { title: 'c' }])
    expect(result.imported).toBe(3)
  })

  it('refuses up front when the posts would pass maxPosts, naming how many fit', async () => {
    const boardId = await seedBoard()
    const before = await count(posts)
    vi.mocked(getTierLimits).mockResolvedValue({ ...OSS_TIER_LIMITS, maxPosts: before + 2 })

    const err = await runImport(boardId, [{ title: 'a' }, { title: 'b' }, { title: 'c' }]).catch(
      (e) => e
    )

    expect(err).toBeInstanceOf(TierLimitError)
    expect((err as TierLimitError).limit).toBe('maxPosts')
    expect((err as TierLimitError).message).toContain('2')
    expect(await count(posts)).toBe(before)
  })

  it('allows a run that lands exactly on maxPosts', async () => {
    const boardId = await seedBoard()
    const before = await count(posts)
    vi.mocked(getTierLimits).mockResolvedValue({ ...OSS_TIER_LIMITS, maxPosts: before + 2 })

    const result = await runImport(boardId, [{ title: 'a' }, { title: 'b' }])
    expect(result.imported).toBe(2)
  })

  it('refuses up front when new boards would pass maxBoards, writing nothing', async () => {
    const boardId = await seedBoard()
    const boardsBefore = await count(boards)
    const postsBefore = await count(posts)
    vi.mocked(getTierLimits).mockResolvedValue({ ...OSS_TIER_LIMITS, maxBoards: boardsBefore })

    const err = await runImport(boardId, [
      { title: 'a', board: `New One ${suffix()}` },
      { title: 'b' },
    ]).catch((e) => e)

    expect(err).toBeInstanceOf(TierLimitError)
    expect((err as TierLimitError).limit).toBe('maxBoards')
    expect(await count(boards)).toBe(boardsBefore)
    expect(await count(posts)).toBe(postsBefore)
  })

  it('does not count a board the CSV only references by an existing name', async () => {
    const boardId = await seedBoard()
    const boardsBefore = await count(boards)
    vi.mocked(getTierLimits).mockResolvedValue({ ...OSS_TIER_LIMITS, maxBoards: boardsBefore })
    const [existing] = await testDb.select().from(boards).limit(1)

    const result = await runImport(boardId, [{ title: 'a', board: existing.slug }])
    expect(result.imported).toBe(1)
  })
})
