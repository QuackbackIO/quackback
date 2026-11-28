/**
 * The languages of articles in the admin list: one state per language for
 * each article, and the "Languages" filter.
 */
import {
  db,
  and,
  inArray,
  helpCenterArticleTranslations,
  helpCenterArticles,
  sql,
} from '@/lib/server/db'
import type { SQL } from 'drizzle-orm'

/** One language of an article in the list. */
export type ArticleLanguageState = 'published' | 'draft' | 'needs_update' | 'missing'

export interface ArticleLanguageSummary {
  locale: string
  state: ArticleLanguageState
}

/** The list filter: articles with a language behind, or a language missing. */
export type ArticleLanguageFilter = 'needs_update' | 'missing'

/**
 * For each article, the state of each help center language other than its
 * own: missing, needs update (behind its article, or an AI update waiting),
 * else its publish state.
 */
export async function listArticleLanguageSummaries(
  articles: ReadonlyArray<{ id: string; locale: string; textRevision: number }>,
  locales: readonly string[]
): Promise<Map<string, ArticleLanguageSummary[]>> {
  const result = new Map<string, ArticleLanguageSummary[]>()
  if (articles.length === 0 || locales.length === 0) return result
  const t = helpCenterArticleTranslations
  const rows = await db
    .select({
      articleId: t.articleId,
      locale: t.locale,
      status: t.status,
      sourceRevision: t.sourceRevision,
      pending: sql<boolean>`${t.pendingTitle} IS NOT NULL`,
    })
    .from(t)
    .where(
      and(
        inArray(
          t.articleId,
          articles.map((a) => a.id as never)
        ),
        inArray(t.locale, [...locales])
      )
    )
  const byKey = new Map(rows.map((r) => [`${r.articleId}:${r.locale}`, r]))
  for (const article of articles) {
    result.set(
      article.id,
      locales
        .filter((locale) => locale !== article.locale)
        .map((locale) => {
          const row = byKey.get(`${article.id}:${locale}`)
          if (!row) return { locale, state: 'missing' as const }
          if (row.pending || row.sourceRevision < article.textRevision) {
            return { locale, state: 'needs_update' as const }
          }
          return { locale, state: row.status }
        })
    )
  }
  return result
}

/**
 * The list condition for the "Languages" filter, over the help center's
 * languages. Used inside the relational query builder, which remaps every
 * column object onto the article alias, so the inner table's columns are
 * written raw and only the article's are column objects.
 */
export function articleLanguageFilterCondition(
  filter: ArticleLanguageFilter,
  locales: readonly string[]
): SQL {
  if (locales.length === 0) return sql`false`
  const a = helpCenterArticles
  const list = sql.join(
    locales.map((l) => sql`${l}`),
    sql`, `
  )
  if (filter === 'needs_update') {
    return sql`EXISTS (
      SELECT 1 FROM kb_article_translations kt
      WHERE kt.article_id = ${a.id}
        AND kt.locale <> ${a.locale}
        AND kt.locale IN (${list})
        AND (kt.source_revision < ${a.textRevision} OR kt.pending_title IS NOT NULL)
    )`
  }
  return sql`EXISTS (
    SELECT 1 FROM unnest(ARRAY[${list}]::text[]) AS l(locale)
    WHERE l.locale <> ${a.locale}
      AND NOT EXISTS (
        SELECT 1 FROM kb_article_translations kt
        WHERE kt.article_id = ${a.id} AND kt.locale = l.locale
      )
  )`
}
