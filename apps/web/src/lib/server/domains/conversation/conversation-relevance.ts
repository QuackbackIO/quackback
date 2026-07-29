/**
 * Relevance scoring for inbox search. A searched conversation list is ordered
 * by how well each thread answers the term, not by the list's active sort —
 * "most recent" is the right default for browsing an inbox and the wrong one
 * for finding a thread.
 *
 * The score blends the three signals a support agent actually searches on,
 * each normalized to a known band so the weights below express their intended
 * precedence:
 *
 *  - keyword: Postgres `ts_rank` over the best-matching message's generated
 *    `search_vector` (0151). ts_rank is frequency- and density-weighted, so a
 *    thread that returns to the term repeatedly outscores one that mentions it
 *    in passing. Same primitive the ticket search ranks on.
 *  - exactness: how literal the hit is. A visitor whose display name IS the
 *    term beats one whose name merely contains it, which beats a whole-word
 *    hit in a message body, which beats a hit buried inside a longer word.
 *  - recency: a hyperbolic decay on last activity, so two equally good matches
 *    surface the live one first.
 *
 * Scoring is strictly an ORDERING concern: it never removes a row the search
 * predicate matched. A conversation whose only hit is a substring inside a
 * longer word scores on recency alone and lands at the bottom of the page,
 * still reachable.
 */
import { conversations, conversationMessages, principal, sql } from '@/lib/server/db'
import type { SQL } from 'drizzle-orm'

/**
 * Keyword weight. `ts_rank` occupies a narrow band in practice (~0.06 for a
 * single hit, saturating near ~0.09 once a term repeats several times), so
 * this scales that band to roughly 0.5-0.75 — wide enough that a genuinely
 * repeated term clears the whole recency spread on its own.
 */
const KEYWORD_WEIGHT = 8

/** Exactness weight, over a 0-2 signal. A literal hit is worth more than any
 *  number of extra repetitions of a stemmed one, and the top tier — the
 *  visitor's name IS the term — sits above everything the other two signals
 *  can add up to, because that is the least ambiguous thing an agent can type. */
const EXACTNESS_WEIGHT = 1

/** Recency weight, over a 0-1 signal. Deliberately the smallest of the three:
 *  recency separates near-ties, it never outranks a stronger match. */
const RECENCY_WEIGHT = 0.15

/** Days after which the recency signal has halved. */
const RECENCY_HALF_LIFE_DAYS = 7

/**
 * Escape a search term for use as a POSIX regular expression literal. The term
 * is operator input, so every metacharacter must lose its meaning before the
 * word-boundary wrapper is applied.
 */
export function escapePosixRegex(term: string): string {
  return term.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&')
}

/**
 * The relevance score expression for one conversation row, as a float8 in
 * roughly 0-3. `asOf` anchors the recency decay to a single instant for the
 * whole request, so the score is a pure function of the row and the term —
 * which is what lets the keyset cursor compare scores exactly.
 */
export function conversationRelevanceSql(term: string, asOf: Date): SQL<number> {
  const tsQuery = sql`websearch_to_tsquery('english', ${term})`
  // \m and \M anchor to a word start/end, so "bill" is a whole-word hit in
  // "the bill" but not in "billing".
  const wholeWord = `\\m${escapePosixRegex(term)}\\M`

  const keyword = sql<number>`COALESCE((
      SELECT max(ts_rank(m.search_vector, ${tsQuery}))
      FROM ${conversationMessages} m
      WHERE m.conversation_id = ${conversations.id}
        AND m.deleted_at IS NULL
        AND m.search_vector @@ ${tsQuery}
    ), 0)::float8`

  const exactness = sql<number>`GREATEST(
      COALESCE((
        SELECT CASE
                 WHEN lower(p.display_name) = lower(${term}) THEN 2.0
                 WHEN p.display_name ~* ${wholeWord} THEN 0.8
                 ELSE 0.0
               END
        FROM ${principal} p
        WHERE p.id = ${conversations.visitorPrincipalId}
      ), 0.0),
      CASE WHEN EXISTS (
        SELECT 1
        FROM ${conversationMessages} m
        WHERE m.conversation_id = ${conversations.id}
          AND m.deleted_at IS NULL
          AND m.content ~* ${wholeWord}
      ) THEN 0.5 ELSE 0.0 END
    )::float8`

  const recency = sql<number>`(1.0 / (1.0 + GREATEST(
      0,
      EXTRACT(EPOCH FROM (${asOf.toISOString()}::timestamptz - ${conversations.lastMessageAt}))
    ) / 86400.0 / ${RECENCY_HALF_LIFE_DAYS}::float8))::float8`

  return sql<number>`(
      ${KEYWORD_WEIGHT}::float8 * ${keyword}
      + ${EXACTNESS_WEIGHT}::float8 * ${exactness}
      + ${RECENCY_WEIGHT}::float8 * ${recency}
    )`
}
