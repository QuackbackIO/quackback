/**
 * Two import rules over real rows:
 *
 * - A re-import (a row whose source_id was imported before) updates the post,
 *   but a blank status or vote_count cell keeps what the post has; an explicit
 *   0 still writes 0, and a new post with blank cells still gets the defaults.
 * - A row naming a deleted board, status or tag gets a fresh live one, never
 *   the deleted row, and a deleted default status is not the fallback.
 *
 * Real Postgres in a rolled-back transaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type BoardId, type PostStatusId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  eq,
  postStatuses,
  postTagAssignments,
  postTags,
  posts,
  principal,
  user,
} from '@/lib/server/db'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: async () => OSS_TIER_LIMITS,
}))
vi.mock('@/lib/server/domains/settings/cloud/cloud.service', async () => {
  const { DISABLED_CLOUD_CONFIG } = await import('@/lib/server/domains/settings/cloud/cloud.types')
  return { getCloudConfig: async () => DISABLED_CLOUD_CONFIG }
})

const { processImport } = await import('../import-service')
const { ensureBatchTag } = await import('../import-run.service')

const fixture = await createDbTestFixture()
const tag = Math.random().toString(36).slice(2, 8)

type Row = Partial<
  Record<'title' | 'status' | 'vote_count' | 'board' | 'tags' | 'source_id', string>
>
const COLUMNS = ['title', 'status', 'vote_count', 'board', 'tags', 'source_id'] as const

function csv(rows: Row[]): string {
  const cell = (v: string | undefined) => `"${(v ?? '').replace(/"/g, '""')}"`
  const lines = [`${COLUMNS.join(',')},content,author_name`]
  for (const r of rows) lines.push(`${COLUMNS.map((c) => cell(r[c])).join(',')},body,Alice`)
  return Buffer.from(lines.join('\n')).toString('base64')
}

async function postTitled(title: string) {
  const [row] = await testDb.select().from(posts).where(eq(posts.title, title))
  return row
}

describe.skipIf(!fixture.available)('CSV import (real DB)', () => {
  let boardId: BoardId
  let importer: PrincipalId

  async function run(rows: Row[]) {
    return processImport({
      boardId,
      csvContent: csv(rows),
      totalRows: rows.length,
      initiatedByPrincipalId: importer,
    })
  }

  async function status(slug: string, extra: Partial<typeof postStatuses.$inferInsert> = {}) {
    const id = createId('post_status') as PostStatusId
    await testDb.insert(postStatuses).values({ id, name: slug, slug, ...extra })
    return id
  }

  beforeEach(async () => {
    await fixture.begin()
    const userId = createId('user')
    importer = createId('principal') as PrincipalId
    await testDb.insert(user).values({ id: userId, name: 'Importer', email: `i-${tag}@x.io` })
    await testDb
      .insert(principal)
      .values({ id: importer, userId, role: 'admin', type: 'user', createdAt: new Date() })
    boardId = createId('board') as BoardId
    await testDb.insert(boards).values({ id: boardId, name: `Home ${tag}`, slug: `home-${tag}` })
  })
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())

  describe('re-import by source_id', () => {
    it('keeps the stored status and vote count when the cells are blank', async () => {
      const planned = await status(`planned_${tag}`)
      const source = `src-${tag}`
      await run([
        { title: `first ${tag}`, status: `planned_${tag}`, vote_count: '7', source_id: source },
      ])
      const result = await run([{ title: `retitled ${tag}`, source_id: source }])

      expect(result.updated).toBe(1)
      const post = await postTitled(`retitled ${tag}`)
      expect(post.voteCount).toBe(7)
      expect(post.statusId).toBe(planned)
    })

    it('writes an explicit 0 vote count', async () => {
      const source = `src0-${tag}`
      await run([{ title: `counted ${tag}`, vote_count: '7', source_id: source }])
      await run([{ title: `zeroed ${tag}`, vote_count: '0', source_id: source }])

      expect((await postTitled(`zeroed ${tag}`)).voteCount).toBe(0)
    })

    it('gives a new post with blank cells the default status and no votes', async () => {
      await testDb.update(postStatuses).set({ isDefault: false })
      const open = await status(`open_${tag}`, { isDefault: true })
      await run([{ title: `fresh ${tag}` }])

      const post = await postTitled(`fresh ${tag}`)
      expect(post.voteCount).toBe(0)
      expect(post.statusId).toBe(open)
    })
  })

  describe('deleted boards, statuses and tags', () => {
    it('gives a row naming a deleted board, status and tag fresh live ones', async () => {
      const gone = new Date()
      const goneBoard = createId('board') as BoardId
      await testDb
        .insert(boards)
        .values({ id: goneBoard, name: `Gone ${tag}`, slug: `gone-${tag}`, deletedAt: gone })
      const goneStatus = await status(`gone_${tag}`, { deletedAt: gone })
      const goneTag = createId('post_tag')
      await testDb
        .insert(postTags)
        .values({ id: goneTag, name: `gone-tag-${tag}`, deletedAt: gone })

      const result = await run([
        {
          title: `names deleted ${tag}`,
          board: `gone-${tag}`,
          status: `gone_${tag}`,
          tags: `gone-tag-${tag}`,
        },
      ])
      expect(result.imported).toBe(1)

      const post = await postTitled(`names deleted ${tag}`)
      expect(post.boardId).not.toBe(goneBoard)
      expect(post.statusId).not.toBe(goneStatus)
      const [board] = await testDb.select().from(boards).where(eq(boards.id, post.boardId))
      expect(board).toMatchObject({ slug: `gone-${tag}`, deletedAt: null })
      const [st] = await testDb
        .select()
        .from(postStatuses)
        .where(eq(postStatuses.id, post.statusId!))
      expect(st).toMatchObject({ name: `gone_${tag}`, deletedAt: null })
      const tags = await testDb
        .select({ id: postTags.id, deletedAt: postTags.deletedAt })
        .from(postTagAssignments)
        .innerJoin(postTags, eq(postTags.id, postTagAssignments.tagId))
        .where(eq(postTagAssignments.postId, post.id))
      expect(tags).toEqual([{ id: expect.not.stringMatching(goneTag), deletedAt: null }])
    })

    it('does not fall back to a deleted default status', async () => {
      await testDb.update(postStatuses).set({ isDefault: false })
      await status(`gone_default_${tag}`, { isDefault: true, deletedAt: new Date() })
      await run([{ title: `no status ${tag}` }])

      expect((await postTitled(`no status ${tag}`)).statusId).toBeNull()
    })

    it('makes a fresh batch tag when the day’s batch tag was deleted', async () => {
      const first = await ensureBatchTag('csv')
      await testDb.update(postTags).set({ deletedAt: new Date() }).where(eq(postTags.id, first.id))

      const second = await ensureBatchTag('csv')
      expect(second.id).not.toBe(first.id)
      expect(second.name).toBe(first.name)
    })
  })
})
