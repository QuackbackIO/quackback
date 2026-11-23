/**
 * The widget's board list carries each board's custom fields, so the widget
 * composer can ask for the answers the board requires before it posts.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type BoardId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards } from '@/lib/server/db'
import type { BoardCustomField } from '@/lib/shared/db-types'

// The application cache, kept in memory: its kv rows are shared by every test
// file on the database.
const cache = vi.hoisted(() => new Map<string, unknown>())
vi.mock('@/lib/server/cache', async (original) => ({
  ...(await original<typeof import('@/lib/server/cache')>()),
  cacheGet: async (key: string) => (cache.has(key) ? structuredClone(cache.get(key)) : null),
  cacheSet: async (key: string, value: unknown) => {
    cache.set(key, structuredClone(value))
  },
  cacheDel: async (...keys: string[]) => {
    for (const key of keys) cache.delete(key)
  },
}))
vi.mock('@tanstack/react-start', async (original) => ({
  ...(await original<typeof import('@tanstack/react-start')>()),
  createServerOnlyFn: <T>(fn: T) => fn,
}))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { runFetchBoardCapabilities } from '../portal'

const fixture = await createDbTestFixture()
const PLAN: BoardCustomField = { key: 'plan', label: 'Your plan', type: 'text', required: true }
let withFields: BoardId, plain: BoardId

async function board(customFields?: BoardCustomField[]) {
  const id = createId('board')
  await testDb.insert(boards).values({
    id,
    name: 'Acme',
    slug: String(id),
    settings: customFields ? { customFields } : {},
  })
  return id
}

describe('widget board list', () => {
  beforeEach(async () => {
    expect(fixture.available).toBe(true)
    cache.clear()
    await fixture.begin()
    withFields = await board([PLAN])
    plain = await board()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it("sends a board's custom fields, and nothing extra for a board without any", async () => {
    const { boards: listed } = await runFetchBoardCapabilities(null)

    expect(listed.find((b) => b.id === withFields)).toEqual({
      id: withFields,
      name: 'Acme',
      slug: String(withFields),
      customFields: [PLAN],
    })
    expect(Object.keys(listed.find((b) => b.id === plain)!).sort()).toEqual(['id', 'name', 'slug'])
  })
})
