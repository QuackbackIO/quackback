/**
 * Real-DB coverage for plan caps on the CSV import pipeline: a run that would
 * create more boards or posts than the plan allows is refused before anything
 * is written, with an error that names the plan and its cap.
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

vi.mock('@/lib/server/domains/settings/cloud/cloud.service', () => ({
  getCloudConfig: vi.fn(),
}))

import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { getCloudConfig } from '@/lib/server/domains/settings/cloud/cloud.service'
import { DISABLED_CLOUD_CONFIG } from '@/lib/server/domains/settings/cloud/cloud.types'
import { processImport } from '../import-service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: boards.id }).from(boards).limit(0)
    await db.select({ id: posts.id }).from(posts).limit(0)
  },
})

const allows = (cap: number, noun: string) => `${cap} ${noun}${cap === 1 ? '' : 's'}`

const suffix = () => Math.random().toString(36).slice(2, 8)

type Row = { title: string; board?: string; sourceId?: string }

function csv(rows: Row[]): string {
  const lines = ['title,content,board,author_name,source_id']
  for (const r of rows) lines.push(`${r.title},body,${r.board ?? ''},Alice,${r.sourceId ?? ''}`)
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

async function runImport(boardId: BoardId, rows: Row[]) {
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
    vi.mocked(getCloudConfig).mockResolvedValue({
      ...DISABLED_CLOUD_CONFIG,
      enabled: true,
      plan: 'free',
    })
  })
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())

  it('imports everything when limits are unlimited', async () => {
    const boardId = await seedBoard()
    const result = await runImport(boardId, [{ title: 'a' }, { title: 'b' }, { title: 'c' }])
    expect(result.imported).toBe(3)
  })

  it('refuses up front when the posts would pass maxPosts, naming the plan and its cap', async () => {
    const boardId = await seedBoard()
    const before = await count(posts)
    vi.mocked(getTierLimits).mockResolvedValue({ ...OSS_TIER_LIMITS, maxPosts: before + 2 })

    const err = await runImport(boardId, [{ title: 'a' }, { title: 'b' }, { title: 'c' }]).catch(
      (e) => e
    )

    expect(err).toBeInstanceOf(TierLimitError)
    expect((err as TierLimitError).limit).toBe('maxPosts')
    expect((err as TierLimitError).max).toBe(before + 2)
    expect((err as TierLimitError).message).toBe(
      `Not imported: the Free plan allows ${allows(before + 2, 'post')}.`
    )
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
    expect((err as TierLimitError).message).toBe(
      `Not imported: the Free plan allows ${allows(boardsBefore, 'board')}.`
    )
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

  it('allows a new board that lands exactly on maxBoards', async () => {
    const boardId = await seedBoard()
    const boardsBefore = await count(boards)
    vi.mocked(getTierLimits).mockResolvedValue({ ...OSS_TIER_LIMITS, maxBoards: boardsBefore + 1 })

    const result = await runImport(boardId, [{ title: 'a', board: `New One ${suffix()}` }])
    expect(result.imported).toBe(1)
    expect(await count(boards)).toBe(boardsBefore + 1)
  })

  it('does not count soft-deleted posts against maxPosts', async () => {
    const boardId = await seedBoard()
    await runImport(boardId, [{ title: 'gone' }])
    await testDb.update(posts).set({ deletedAt: new Date() })
    const live = await testDb
      .select({ n: sql<number>`count(*)::int` })
      .from(posts)
      .where(sql`${posts.deletedAt} is null`)
    vi.mocked(getTierLimits).mockResolvedValue({
      ...OSS_TIER_LIMITS,
      maxPosts: (live[0]?.n ?? 0) + 1,
    })

    const result = await runImport(boardId, [{ title: 'b' }])
    expect(result.imported).toBe(1)
  })

  it('does not count rows that update a previously imported post', async () => {
    const boardId = await seedBoard()
    const sourceId = `src-${suffix()}`
    await runImport(boardId, [{ title: 'first', sourceId }])
    vi.mocked(getTierLimits).mockResolvedValue({ ...OSS_TIER_LIMITS, maxPosts: await count(posts) })

    const result = await runImport(boardId, [{ title: 'again', sourceId }])
    expect(result.updated).toBe(1)

    const err = await runImport(boardId, [{ title: 'again', sourceId }, { title: 'new' }]).catch(
      (e) => e
    )
    expect(err).toBeInstanceOf(TierLimitError)
  })

  it('names no plan when the limits come from the instance configuration', async () => {
    const boardId = await seedBoard()
    const before = await count(posts)
    vi.mocked(getCloudConfig).mockResolvedValue(DISABLED_CLOUD_CONFIG)
    vi.mocked(getTierLimits).mockResolvedValue({ ...OSS_TIER_LIMITS, maxPosts: before })

    const err = await runImport(boardId, [{ title: 'a' }]).catch((e) => e)
    expect(err).toBeInstanceOf(TierLimitError)
    expect((err as TierLimitError).message).toBe(
      `Not imported: this workspace allows ${allows(before, 'post')}.`
    )
  })
})
