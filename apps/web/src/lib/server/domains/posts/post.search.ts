/**
 * Keyword search over posts (title weighted above details), shared by the
 * portal feed, the widget and the admin inbox.
 *
 * Every word matches as the start of a word, so a search typed a few
 * letters at a time finds results as it goes ("Zap" finds "Zapier", and
 * "integrati" finds "integration" although the index keeps only its stem,
 * "integr": see termMatch). All
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
 * Characters past this many are ignored, so a long pasted string (or an old
 * link carrying one) still searches, by its start, instead of failing.
 */
const MAX_SEARCH_LENGTH = 200

/** The search as it is read: at most MAX_SEARCH_LENGTH characters. */
function clip(search: string): string {
  return search.slice(0, MAX_SEARCH_LENGTH)
}

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
  return (
    clip(search)
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).slice(0, MAX_TERMS)
}

/** Whether Postgres should read the search as written: see OPERATORS and WHOLE_TOKEN. */
function usesQuerySyntax(search: string): boolean {
  const read = clip(search)
  return OPERATORS.test(read) || WHOLE_TOKEN.test(read)
}

/** A search Postgres reads as written (see usesQuerySyntax). */
function writtenQuery(search: string): SQL {
  return sql`websearch_to_tsquery('english', ${clip(search)})`
}

/** Whether a fallback can change anything: plain words, not operators. */
export function canWidenSearch(search: string | undefined): boolean {
  return !!search && !usesQuerySyntax(search) && searchTerms(search).length > 0
}

/** One word as a prefix tsquery. A stop word ("the") comes back empty. */
function termQuery(term: string): SQL {
  return sql`to_tsquery('english', ${`${term}:*`})`
}

/**
 * Limits on looking for a shorter stem (termMatch). A stem shorter than
 * MIN_STEM_LENGTH is shared by too many words, and an english stem drops at
 * most a few letters from the end of a word, so only the starts of the typed
 * word at most MAX_STEM_TRIM letters shorter are tried. Words longer than
 * MAX_WIDEN_LENGTH are not partial words anyone types, and only the first
 * MAX_WIDENED_WORDS words of a search are widened this way, which keeps the
 * query small.
 */
const MIN_STEM_LENGTH = 5
const MAX_STEM_TRIM = 4
const MAX_WIDEN_LENGTH = 32
const MAX_WIDENED_WORDS = 5

/** The shorter stems a typed word may be kept as: "integrati" -> integ…integrat. */
export function shorterStems(term: string, position: number): string[] {
  const letters = Array.from(term)
  if (position >= MAX_WIDENED_WORDS || letters.length > MAX_WIDEN_LENGTH) return []
  const stems: string[] = []
  const from = Math.max(MIN_STEM_LENGTH, letters.length - MAX_STEM_TRIM)
  for (let length = from; length < letters.length; length++) {
    stems.push(letters.slice(0, length).join(''))
  }
  return stems
}

/** The post's words as written, for the check a shorter stem needs. */
const postText = sql`(coalesce(${posts.title}, '') || ' ' || coalesce(${posts.content}, ''))`

/**
 * One typed word as the start of a word in the post. The index holds english
 * stems, and a partial word stems differently from the whole one, so the
 * english prefix query alone misses: "integrati" is not a prefix of
 * "integr" (integration), "notifica" not of "notif" (notifications), and
 * "copy" stems to "copi", not a prefix of "copyright". So a word also
 * matches:
 *
 *  - a stem that starts with it as typed ("copy" finds "copyright");
 *  - a stem that is a few letters shorter start of it ("integr" for
 *    "integrati", see shorterStems), when the post has a word that really
 *    starts with the typed letters. The index finds the candidates; the check
 *    keeps "integrity", which stems to "integr" too, out of a search for
 *    "integrati". A whole word ("users", "integration") has no shorter stem
 *    to try that the english query does not already cover.
 *
 * `candidates` is the tsquery the index serves; `matches` is true for a post
 * that has the word. A stop word ("the") has neither: it matches nothing, as
 * in the english query, and never widens to "theme".
 */
function termMatch(term: string, position: number): { candidates: SQL; matches: SQL; isWord: SQL } {
  const english = termQuery(term)
  const typed = sql`to_tsquery('simple', ${`${term}:*`})`
  const stems = shorterStems(term, position)
  const shorter = stems.length > 0 ? sql`to_tsquery('simple', ${stems.join(' | ')})` : null
  const isWord = sql`(numnode(${english}) > 0)`
  const widened = shorter ? sql`${english} || ${typed} || ${shorter}` : sql`${english} || ${typed}`
  const startsAWord = shorter
    ? sql` OR (${posts.searchVector} @@ ${shorter} AND ${postText} ~* ${`\\m${term}`})`
    : sql``
  return {
    candidates: sql`(CASE WHEN ${isWord} THEN ${widened} ELSE ${english} END)`,
    matches: sql`(${isWord} AND (${posts.searchVector} @@ ${english} OR ${posts.searchVector} @@ ${typed}${startsAWord}))`,
    isWord,
  }
}

/**
 * Posts with every word (join '&') or any word ('|'), each as the start of a
 * word (termMatch). The index finds the candidates; each word is then
 * checked. Stop words are left out, as the english query leaves them.
 */
function wordsCondition(terms: string[], join: '&' | '|'): SQL {
  const parts = terms.map((term, position) => termMatch(term, position))
  const candidates = sql.join(
    parts.map((part) => part.candidates),
    join === '&' ? sql` && ` : sql` || `
  )
  const index = sql`${posts.searchVector} @@ (${candidates})`
  if (join === '|') return index
  const every = sql.join(
    parts.map((part) => sql`(NOT ${part.isWord} OR ${part.matches})`),
    sql` AND `
  )
  return sql`(${index} AND ${every})`
}

/** The search as one tsquery: every word, or any word. Null when it has none. */
function postSearchQuery(search: string, join: '&' | '|'): SQL | null {
  if (usesQuerySyntax(search)) return writtenQuery(search)
  const terms = searchTerms(search)
  if (terms.length === 0) return null
  return sql`to_tsquery('english', ${terms.map((term) => `${term}:*`).join(` ${join} `)})`
}

/**
 * Every word of the search as a prefix match (or the search as written when
 * it uses operators), for any english tsvector. Null when it has no words.
 * Workspace search reuses it so every kind reads a query the same way.
 */
export function keywordTsQuery(search: string): SQL | null {
  return postSearchQuery(search, '&')
}

/**
 * How many of the search's words a post has, and how many words count (stop
 * words match nothing, so they don't count toward the half).
 */
function matchedTerms(search: string): { matched: SQL; counted: SQL } {
  const terms = searchTerms(search).map((term, position) => termMatch(term, position))
  return {
    matched: sql.join(
      terms.map((term) => sql`(${term.matches})::int`),
      sql` + `
    ),
    counted: sql.join(
      terms.map((term) => sql`(${term.isWord})::int`),
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
  if (usesQuerySyntax(search)) {
    return sql`${posts.searchVector} @@ ${writtenQuery(search)}`
  }
  const terms = searchTerms(search)
  if (terms.length === 0) return sql`false`
  // The any-word query lets the full-text index find the candidates; the
  // count then keeps the posts with at least half of the words.
  if (mode === 'most') {
    const { matched, counted } = matchedTerms(search)
    return sql`(${wordsCondition(terms, '|')} AND (${matched}) * 2 >= (${counted}))`
  }
  return wordsCondition(terms, '&')
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
