/**
 * Search-term analytics: visitor queries are recorded with their result
 * counts, and the admin aggregation ranks normalized terms by search volume
 * while surfacing which ones returned nothing.
 *
 * Runs the real service functions against the real database (same pattern as
 * help-center-segment-gate.integration.test.ts); skips gracefully when no
 * database is reachable.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'

import { helpCenterSearchQueries, type Database } from '@/lib/server/db'
// oxlint-disable-next-line no-restricted-imports -- legitimate createDb caller: this file owns the global db for its worker (see help-center-segment-gate.integration.test.ts)
import { createDb } from '@quackback/db/client'
import { recordSearchQuery, listTopSearchTerms } from '../help-center.search-analytics'

const CANDIDATE_URLS = [
  process.env.DATABASE_URL,
  'postgresql://postgres:password@localhost:5432/quackback',
].filter((u): u is string => !!u)

async function pickWorkingDb(): Promise<{ db: Database; close: () => Promise<void> } | null> {
  for (const url of CANDIDATE_URLS) {
    try {
      const db = createDb(url, { max: 4, prepare: false })
      await db.execute(sql`select 1`)
      await db.execute(sql`select id from ${helpCenterSearchQueries} limit 0`)
      return {
        db,
        close: async () => {
          const raw = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client
          await raw?.end?.()
        },
      }
    } catch {
      // try next candidate
    }
  }
  return null
}

const resolved = await pickWorkingDb()
const dbAvailable = resolved !== null
if (resolved) {
  ;(globalThis as Record<string, unknown>).__db = resolved.db
}

// Unique run token so seeded rows never collide with other runs sharing a DB.
const runSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const term = (name: string) => `wombat-${runSuffix}-${name}`

describe.skipIf(!dbAvailable)('help-center search analytics', () => {
  afterAll(async () => {
    if (resolved) {
      await resolved.db.execute(
        sql`delete from kb_search_queries where normalized_query like ${'wombat-' + runSuffix + '%'}`
      )
      await resolved.close()
    }
  })

  it('records a query with its result count', async () => {
    await recordSearchQuery({ query: term('billing'), locale: 'en', resultsCount: 3 })
    const rows = await resolved!.db.execute(
      sql`select query, normalized_query, results_count from kb_search_queries where normalized_query = ${term('billing')}`
    )
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].results_count)).toBe(3)
  })

  it('skips blank queries', async () => {
    await recordSearchQuery({ query: '   ', locale: 'en', resultsCount: 0 })
    const rows = await resolved!.db.execute(
      sql`select id from kb_search_queries where normalized_query = ''`
    )
    expect(rows).toHaveLength(0)
  })

  it('normalizes case and whitespace so variants group together', async () => {
    await recordSearchQuery({ query: term('Invoice'), locale: 'en', resultsCount: 2 })
    await recordSearchQuery({
      query: `  ${term('invoice').toUpperCase()} `,
      locale: 'en',
      resultsCount: 0,
    })
    await recordSearchQuery({ query: term('invoice'), locale: 'en', resultsCount: 0 })

    const terms = await listTopSearchTerms({ days: 30, limit: 50 })
    const row = terms.find((t) => t.normalizedQuery === term('invoice'))
    expect(row).toBeDefined()
    expect(row!.searches).toBe(3)
    expect(row!.zeroResultSearches).toBe(2)
  })

  it('ranks by search volume and marks terms that only ever miss', async () => {
    // A zero-result term searched twice outranks a hit term searched once.
    await recordSearchQuery({ query: term('hit'), locale: 'en', resultsCount: 5 })
    await recordSearchQuery({ query: term('miss'), locale: 'en', resultsCount: 0 })
    await recordSearchQuery({ query: term('miss'), locale: 'en', resultsCount: 0 })

    const terms = await listTopSearchTerms({ days: 30, limit: 50 })
    const mine = terms.filter((t) => [term('miss'), term('hit')].includes(t.normalizedQuery))
    // 2 zero-result searches outrank 1 successful search.
    expect(mine[0].normalizedQuery).toBe(term('miss'))
    expect(mine[0].zeroResultSearches).toBe(mine[0].searches)
    expect(mine[1].normalizedQuery).toBe(term('hit'))
    expect(mine[1].zeroResultSearches).toBe(0)
  })
})
