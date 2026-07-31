/**
 * Help-center search-term analytics.
 *
 * Every visitor search (portal /hc box, widget) is recorded with its result
 * count; the admin aggregation ranks normalized terms by volume and surfaces
 * the ones that returned nothing — the content-gap signal.
 */
import { db, helpCenterSearchQueries, sql } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'help-center-search-analytics' })

/** Cap on the stored raw query — a search box pastes can be unbounded. */
const MAX_QUERY_LENGTH = 200

/** Grouping key: trim, collapse inner whitespace, lowercase. */
export function normalizeSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Record one visitor search. Blank queries carry no signal and are skipped.
 * Called fire-and-forget from the public search path; failures are logged,
 * never surfaced to the searcher.
 */
export async function recordSearchQuery(input: {
  query: string
  locale: string
  resultsCount: number
}): Promise<void> {
  const normalized = normalizeSearchQuery(input.query)
  if (!normalized) return
  await db.insert(helpCenterSearchQueries).values({
    query: input.query.trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY_LENGTH),
    normalizedQuery: normalized.slice(0, MAX_QUERY_LENGTH),
    locale: input.locale,
    resultsCount: input.resultsCount,
  })
}

/** Fire-and-forget wrapper for the search hot path. */
export function logSearchQuery(input: {
  query: string
  locale: string
  resultsCount: number
}): void {
  recordSearchQuery(input).catch((err) =>
    log.error({ err, query: input.query }, 'failed to record help-center search query')
  )
}

export interface SearchTermRow {
  /** Raw exemplar (most recent form) for display. */
  term: string
  normalizedQuery: string
  searches: number
  /** How many of those searches returned zero results. */
  zeroResultSearches: number
  lastSearchedAt: Date
}

/**
 * Most-searched visitor terms within a trailing window, ranked by volume.
 * `zeroResultSearches` lets the admin see which terms visitors search for and
 * find nothing — the articles worth writing.
 */
export async function listTopSearchTerms(options: {
  days?: number
  limit?: number
}): Promise<SearchTermRow[]> {
  const days = options.days ?? 30
  const limit = options.limit ?? 50
  // ISO string rather than Date: prepare:false connections (integration
  // tests, pgbouncer-style setups) cannot serialize Date params.
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const rows = await db
    .select({
      term: sql<string>`(array_agg(${helpCenterSearchQueries.query} ORDER BY ${helpCenterSearchQueries.createdAt} DESC))[1]`,
      normalizedQuery: helpCenterSearchQueries.normalizedQuery,
      searches: sql<number>`count(*)::int`,
      zeroResultSearches: sql<number>`count(*) filter (where ${helpCenterSearchQueries.resultsCount} = 0)::int`,
      lastSearchedAt: sql<Date>`max(${helpCenterSearchQueries.createdAt})`,
    })
    .from(helpCenterSearchQueries)
    .where(sql`${helpCenterSearchQueries.createdAt} >= ${since}`)
    .groupBy(helpCenterSearchQueries.normalizedQuery)
    .orderBy(sql`count(*) DESC, max(${helpCenterSearchQueries.createdAt}) DESC`)
    .limit(limit)

  return rows.map((r) => ({
    term: r.term,
    normalizedQuery: r.normalizedQuery,
    searches: Number(r.searches),
    zeroResultSearches: Number(r.zeroResultSearches),
    lastSearchedAt: new Date(r.lastSearchedAt),
  }))
}
