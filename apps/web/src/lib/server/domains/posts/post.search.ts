/**
 * Keyword search over posts (title weighted above details), shared by the
 * portal feed, the widget and the admin inbox.
 *
 * Every word matches as the start of a word, so a search typed a few
 * letters at a time finds results as it goes ("Zap" finds "Zapier"). All
 * the words must match; when no post has them all, posts with at least half
 * of them will do (see resolvePostSearchMode). Half, not any one: a stray
 * common word ("post", "add") would otherwise match half the board. A query
 * written with search operators (quotes, a leading minus, OR) keeps its
 * meaning and is never widened.
 */
import type { SQL } from 'drizzle-orm'
import { posts, sql } from '@/lib/server/db'

/** Every word must match, or at least half of them. */
export type PostSearchMode = 'all' | 'most'

/** Words past this many are ignored: they only slow the query down. */
const MAX_TERMS = 10

/** Quotes, a leading minus, or a bare OR: the visitor wrote a query, not words. */
const OPERATORS = /"|(^|\s)-\S|\sOR\s/

/**
 * The words in a search: runs of letters and digits, lowercased. Anything
 * else (punctuation, symbols) separates words, so the result is always safe
 * to hand to to_tsquery.
 */
export function searchTerms(search: string): string[] {
  return (search.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, MAX_TERMS)
}

function usesOperators(search: string): boolean {
  return OPERATORS.test(search)
}

/** Whether the half-the-words fallback can change anything for this search. */
export function canWidenSearch(search: string | undefined): boolean {
  return !!search && !usesOperators(search) && searchTerms(search).length > 1
}

/** One word as a prefix tsquery. A stop word ("the") comes back empty. */
function termQuery(term: string): SQL {
  return sql`to_tsquery('english', ${`${term}:*`})`
}

/** The search as one tsquery: every word, or any word. Null when it has none. */
function postSearchQuery(search: string, join: '&' | '|'): SQL | null {
  if (usesOperators(search)) return sql`websearch_to_tsquery('english', ${search})`
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

/** Posts that match the search. A search with no words matches nothing. */
export function postSearchCondition(search: string, mode: PostSearchMode = 'all'): SQL {
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
 * Best match first: more of the words ahead of fewer, then text rank (a title
 * match outranks one in the details), then votes, and the post id last so
 * pages never repeat or skip a post on a tie.
 */
export function postSearchOrder(search: string, mode: PostSearchMode): SQL[] {
  const tail = [sql`${posts.voteCount} DESC`, sql`${posts.id} DESC`]
  const query = postSearchQuery(search, mode === 'all' ? '&' : '|')
  if (!query) return tail
  const order: SQL[] = []
  if (mode === 'most') order.push(sql`(${matchedTerms(search).matched}) DESC`)
  return [...order, sql`ts_rank(${posts.searchVector}, ${query}) DESC`, ...tail]
}

/**
 * 'all' when some post in scope has every word, otherwise 'most'. The caller
 * passes a probe that runs its own scope with the all-words condition, so
 * the list, its counts and its pages all agree on one mode.
 */
export async function resolvePostSearchMode(
  search: string | undefined,
  hasAllWordsMatch: () => Promise<boolean>
): Promise<PostSearchMode> {
  if (!canWidenSearch(search)) return 'all'
  return (await hasAllWordsMatch()) ? 'all' : 'most'
}
