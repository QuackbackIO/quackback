/**
 * The SQL pieces of workspace search's ranking rule (lib/shared/assistant/
 * ask-search.ts), shared by the full-text and the meaning searches: how a
 * title scores against the query, which records are candidates, and the
 * order each kind keeps its best rows in.
 */
import type { SQL } from 'drizzle-orm'
import { sql } from '@/lib/server/db'

/** `like` pattern text with its wildcards taken literally. */
export function likeText(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`)
}

/**
 * titleTier for one or more title columns: 3 the same as the query, 2 starts
 * with it, 1 contains it, 0 otherwise (case ignored); the best column wins.
 */
export function titleTier(text: string, ...columns: SQL[]): SQL<number> {
  const lower = text.toLowerCase()
  const prefix = `${likeText(lower)}%`
  const contains = `%${likeText(lower)}%`
  const tiers = columns.map(
    (column) => sql`(case when lower(${column}) = ${lower} then 3
      when lower(${column}) like ${prefix} then 2
      when lower(${column}) like ${contains} then 1 else 0 end)`
  )
  return sql<number>`greatest(${sql.join(tiers, sql`, `)}, 0)`
}

/**
 * Contains-matches (a title, name, email or domain with the query anywhere
 * inside) are served by trigram indexes, which cannot narrow a pattern
 * shorter than three characters. Shorter queries rely on full text alone.
 */
export const MIN_CONTAINS_LENGTH = 3

/**
 * The "contains" rule titleTier scores, as a candidate predicate: the
 * column's text has the query anywhere inside, case ignored. An ILIKE, so
 * the column's gin_trgm_ops index serves it. Null below MIN_CONTAINS_LENGTH.
 */
export function titleContains(text: string, column: SQL): SQL | null {
  if (text.length < MIN_CONTAINS_LENGTH) return null
  return sql`${column} ilike ${`%${likeText(text)}%`}`
}

/**
 * A record is a candidate when its text matches the tsquery or its title
 * contains the query (so `fund` finds "Refund policy", and a title of stop
 * words is still found by its words). textScore is ts_rank normalised into
 * 0 to under 1; effectively 0 for a title-only candidate. Null when neither
 * can match.
 */
export function textOrTitle(
  text: string,
  tsq: SQL | null,
  vector: SQL,
  title: SQL
): { where: SQL; textScore: SQL } | null {
  const fts = tsq ? sql`${vector} @@ ${tsq}` : null
  const contains = titleContains(text, title)
  if (!fts) return contains ? { where: contains, textScore: sql`0` } : null
  return {
    where: contains ? sql`(${fts} or ${contains})` : fts,
    // No match-check guard: ts_rank is 0 (or ~1e-20 for a partial AND) on a
    // title-only candidate, and a guard would evaluate the vector once more.
    textScore: sql`ts_rank(${vector}, ${tsq}, 32)`,
  }
}

/** Score order, then the tie-breakers: newest first (no time sorts oldest), then id. */
export function bestFirst(score: SQL, updatedAt: SQL, id: SQL): SQL[] {
  return [sql`${score} desc`, sql`${updatedAt} desc nulls last`, id]
}
