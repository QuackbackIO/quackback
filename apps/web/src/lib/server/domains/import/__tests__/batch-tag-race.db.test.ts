/**
 * Two imports that start together both look for the day's batch tag, miss it,
 * and both insert it. The live name index lets one insert win; the other must
 * read the winner back instead of failing the import on the unique index.
 *
 * Real pooled connections with real commits (the rolled-back fixture runs on
 * one connection, which serialises the two calls). The clock is set to a
 * random day in the 1900s, so the tag name is this run's own; only that name
 * is deleted, before and after.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'

const race = vi.hoisted(() => ({ db: null as unknown }))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: new Proxy(
    {},
    {
      get(_, prop) {
        const target = race.db as Record<string | symbol, unknown>
        const value = target[prop]
        return typeof value === 'function' ? value.bind(target) : value
      },
    }
  ),
}))

import { createDbOnConnection, db, eq, postTags } from '@/lib/server/db'
import { buildBatchTagName, ensureBatchTag } from '../import-run.service'

const DATABASE_URL = process.env.DATABASE_URL
const pool = DATABASE_URL ? postgres(DATABASE_URL, { max: 4, onnotice: () => {} }) : null
if (pool) race.db = createDbOnConnection(pool)

afterAll(async () => {
  await pool?.end()
})

describe.skipIf(!pool)('ensureBatchTag under concurrency (real DB)', () => {
  let name: string

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const day = Math.floor(Math.random() * 365 * 99)
    vi.setSystemTime(new Date(Date.UTC(1900, 0, 1) + day * 86_400_000))
    name = buildBatchTagName('csv')
    await db.delete(postTags).where(eq(postTags.name, name))
    // Open every pooled connection first, so the two calls below really run
    // side by side instead of one finishing while the other connects.
    await Promise.all(Array.from({ length: 4 }, () => pool!`select pg_sleep(0.05)`))
  })
  afterEach(async () => {
    vi.useRealTimers()
    await db.delete(postTags).where(eq(postTags.name, name))
  })

  it('gives two concurrent imports the same live tag', async () => {
    const results = await Promise.allSettled([ensureBatchTag('csv'), ensureBatchTag('csv')])

    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
    const [a, b] = results.map((r) => (r as PromiseFulfilledResult<{ id: string }>).value)
    expect(a.id).toBe(b.id)
    const rows = await db.select({ id: postTags.id }).from(postTags).where(eq(postTags.name, name))
    expect(rows).toEqual([{ id: a.id }])
  })
})
