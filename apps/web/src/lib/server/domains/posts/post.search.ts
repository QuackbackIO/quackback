/**
 * Keyword search over posts (title weighted above details), shared by the
 * portal feed, the widget and the admin inbox.
 *
 * Every word matches as the start of a word, so a search typed a few
 * letters at a time finds results as it goes ("Zap" finds "Zapier"). All
 * the words must match; when no post has them all, posts with at least half
 * of them will do; and when no post has even that, titles with a close
 * spelling do ("integraton" finds "integration"). See resolvePostSearchMode.
 * Half, not any one: a stray common word ("post", "add") would otherwise
 * match half the board. A query written with search operators (quotes, a
 * leading minus, OR), or holding an email address, host or version the index
 * keeps whole, goes to Postgres as written and is never widened.
 */
import type { SQL } from 'drizzle-orm'
import { posts, sql } from '@/lib/server/db'

/**
 * How loosely a search matches: every word, at least half of them, or a
 * title with a close spelling (typo tolerance).
 */
export type PostSearchMode = 'all' | 'most' | 'similar'

/** Words past this many are ignored: they only slow the query down. */
const MAX_TERMS = 10

/**
 * Quotes, a leading minus, or a bare OR (in any case, as websearch_to_tsquery
 * reads it): the visitor wrote a query, not words.
 */
const OPERATORS = /"|(^|\s)-\S|\sor\s/i

/**
 * An email address, host, path or version ("kaye@acme.io", "node.js",
 * "v2.1"): the index holds it as one token, so split into words it would
 * match nothing.
 */
const WHOLE_TOKEN = /[\p{L}\p{N}][@./:][\p{L}\p{N}]/u

/**
 * The words in a search: runs of letters and digits, lowercased. Anything
 * else (punctuation, symbols) separates words, so the result is always safe
 * to hand to to_tsquery.
 */
export function searchTerms(search: string): string[] {
  return (search.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, MAX_TERMS)
}

/** Whether Postgres should read the search as written: see OPERATORS and WHOLE_TOKEN. */
function usesQuerySyntax(search: string): boolean {
  return OPERATORS.test(search) || WHOLE_TOKEN.test(search)
}

/** Whether a fallback can change anything: plain words, not operators. */
export function canWidenSearch(search: string | undefined): boolean {
  return !!search && !usesQuerySyntax(search) && searchTerms(search).length > 0
}

/** One word as a prefix tsquery. A stop word ("the") comes back empty. */
function termQuery(term: string): SQL {
  return sql`to_tsquery('english', ${`${term}:*`})`
}

/** The search as one tsquery: every word, or any word. Null when it has none. */
function postSearchQuery(search: string, join: '&' | '|'): SQL | null {
  if (usesQuerySyntax(search)) return sql`websearch_to_tsquery('english', ${search})`
  const terms = searchTerms(search)
  if (terms.length === 0) return null
  return sql`to_tsquery('english', ${terms.map((term) => `${term}:*`).join(` ${join} `)})`
}

/**
 * How many of the search's words a post has, and how many words count (stop
 * words match nothing, so they don't count toward the half).
 */
function matchedTerms(search: string): { matched: SQL; counted: SQL } {
  const terms = searchTerms(search).map(termQuery)
  return {
    matched: sql.join(
      terms.map((query) => sql`(${posts.searchVector} @@ ${query})::int`),
      sql` + `
    ),
    counted: sql.join(
      terms.map((query) => sql`(numnode(${query}) > 0)::int`),
      sql` + `
    ),
  }
}

/**
 * The words as one string for title similarity. `words <% title` is true when
 * some stretch of the title is within pg_trgm.word_similarity_threshold (0.6)
 * of the words; posts_title_trgm_idx serves it.
 */
function similarWords(search: string): string {
  return searchTerms(search).join(' ')
}

/** Posts that match the search. A search with no words matches nothing. */
export function postSearchCondition(search: string, mode: PostSearchMode = 'all'): SQL {
  if (mode === 'similar') {
    const words = similarWords(search)
    return words ? sql`${words} <% ${posts.title}` : sql`false`
  }
  const any = postSearchQuery(search, mode === 'all' ? '&' : '|')
  if (!any) return sql`false`
  // The any-word query lets the full-text index find the candidates; the
  // count then keeps the posts with at least half of the words.
  if (mode === 'most') {
    const { matched, counted } = matchedTerms(search)
    return sql`(${posts.searchVector} @@ ${any} AND (${matched}) * 2 >= (${counted}))`
  }
  return sql`${posts.searchVector} @@ ${any}`
}

/**
 * What makes one post a better match than another, best first: more of the
 * words ahead of fewer, then text rank (a title match outranks one in the
 * details). A close spelling ranks by how close. Each value sorts descending.
 */
export function postSearchRank(search: string, mode: PostSearchMode): SQL[] {
  if (mode === 'similar') return [sql`word_similarity(${similarWords(search)}, ${posts.title})`]
  const query = postSearchQuery(search, mode === 'all' ? '&' : '|')
  if (!query) return []
  const rank = sql`ts_rank(${posts.searchVector}, ${query})`
  return mode === 'most' ? [sql`(${matchedTerms(search).matched})`, rank] : [rank]
}

/**
 * Best match first (postSearchRank), then votes, and the post id last so
 * pages never repeat or skip a post on a tie.
 */
export function postSearchOrder(search: string, mode: PostSearchMode): SQL[] {
  return [...postSearchRank(search, mode), posts.voteCount, posts.id].map(
    (value) => sql`${value} DESC`
  )
}

/**
 * The strictest mode with a match in scope: every word, then half of them
 * (for two or more words), then a close spelling. The caller passes a probe
 * that runs its own scope with a mode's condition, so the list, its counts
 * and its pages all agree on one mode. A search that matches nothing in any
 * mode stays 'all'.
 */
export async function resolvePostSearchMode(
  search: string | undefined,
  hasMatch: (mode: PostSearchMode) => Promise<boolean>
): Promise<PostSearchMode> {
  if (!canWidenSearch(search)) return 'all'
  if (await hasMatch('all')) return 'all'
  if (searchTerms(search!).length > 1 && (await hasMatch('most'))) return 'most'
  if (await hasMatch('similar')) return 'similar'
  return 'all'
}
