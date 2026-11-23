/**
 * A deleted board is gone from the posts CSV export: asking for it by id is
 * refused as "Board not found", and the all-boards export leaves its posts out.
 *
 * Real Postgres in a rolled-back transaction; only the auth and plan gates are
 * stubbed.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createId, type BoardId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, posts, principal } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: async () => ({ settings: { slug: 'acme' }, principal: { role: 'admin' } }),
}))
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  assertTierFeature: async () => undefined,
}))

const fixture = await createDbTestFixture()
const tag = Math.random().toString(36).slice(2, 8)

async function get(query = ''): Promise<Response> {
  const mod = await import('../export')
  const handler = (
    mod.Route.options as unknown as {
      server: { handlers: { GET: (ctx: { request: Request }) => Promise<Response> } }
    }
  ).server.handlers.GET
  return handler({ request: new Request(`https://app.test/api/export${query}`) })
}

describe.skipIf(!fixture.available)('posts export and deleted boards (real DB)', () => {
  let boardId: BoardId
  const title = `Gone board post ${tag}`

  beforeEach(async () => {
    await fixture.begin()
    const author = createId('principal') as PrincipalId
    await testDb
      .insert(principal)
      .values({ id: author, role: 'user', type: 'anonymous', createdAt: new Date() })
    boardId = createId('board') as BoardId
    await testDb.insert(boards).values({ id: boardId, name: `B ${tag}`, slug: `exp-${tag}` })
    await testDb.insert(posts).values({ boardId, title, content: '', principalId: author })
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('exports a live board by id', async () => {
    const res = await get(`?boardId=${boardId}`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain(title)
  })

  it('refuses a deleted board by id', async () => {
    await testDb.update(boards).set({ deletedAt: new Date() }).where(eq(boards.id, boardId))
    const res = await get(`?boardId=${boardId}`)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Board not found' })
  })

  it('leaves a deleted board out of the all-boards export', async () => {
    await testDb.update(boards).set({ deletedAt: new Date() }).where(eq(boards.id, boardId))
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.text()).not.toContain(title)
  })
})
