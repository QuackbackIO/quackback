/**
 * Locale-aware public reads (domains/languages §2). Every function here
 * delegates to the existing default-locale-gated query for the base
 * published/public predicate, then overlays translated fields for additional
 * locales -- the base article/category must still exist and be public in
 * the default locale; a translation cannot make an otherwise-private or
 * deleted item visible.
 *
 * Homepage visibility gating (§1): a category shows in a locale only when
 * its name is translated (non-empty) AND it has at least one article with a
 * PUBLISHED translation in that locale, directly in that category (v1 scope:
 * subcategory rollup is not counted, matching the direct-children semantics
 * `listPublicArticlesForCategory` already uses). Untranslated articles are
 * simply absent from the locale's article list.
 */
import {
  db,
  eq,
  and,
  inArray,
  isNull,
  isNotNull,
  count,
  helpCenterArticles,
  helpCenterArticleTranslations,
  helpCenterCategoryTranslations,
} from '@/lib/server/db'
import type { KbArticleId, KbCategoryId } from '@quackback/ids'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'
import { NotFoundError } from '@/lib/shared/errors'
import { DEFAULT_LOCALE } from '@/lib/shared/i18n'
import { listPublicCategories, getPublicCategoryBySlug } from './help-center.category.service'
import {
  listPublicArticlesForCategory,
  listPublicArticlesForCategories,
  type PublicCategoryArticle,
} from './help-center.article.query'
import { getPublicArticleBySlug } from './help-center.article.service'
import {
  getPublishedArticleTranslation,
  getCategoryTranslation,
} from './help-center-translations.service'
import type {
  HelpCenterCategoryWithCount,
  HelpCenterArticleWithCategory,
} from './help-center.types'

export async function listPublicCategoriesForLocale(
  locale: string,
  viewer: Actor = ANONYMOUS_ACTOR
): Promise<HelpCenterCategoryWithCount[]> {
  const categories = await listPublicCategories(viewer)
  if (locale === DEFAULT_LOCALE || categories.length === 0) return categories

  const categoryIds = categories.map((c) => c.id)
  const [translations, articleCounts] = await Promise.all([
    db.query.helpCenterCategoryTranslations.findMany({
      where: and(
        inArray(helpCenterCategoryTranslations.categoryId, categoryIds),
        eq(helpCenterCategoryTranslations.locale, locale)
      ),
    }),
    db
      .select({ categoryId: helpCenterArticles.categoryId, translatedCount: count() })
      .from(helpCenterArticles)
      .innerJoin(
        helpCenterArticleTranslations,
        and(
          eq(helpCenterArticleTranslations.articleId, helpCenterArticles.id),
          eq(helpCenterArticleTranslations.locale, locale),
          eq(helpCenterArticleTranslations.status, 'published')
        )
      )
      .where(
        and(
          inArray(helpCenterArticles.categoryId, categoryIds),
          isNull(helpCenterArticles.deletedAt),
          isNotNull(helpCenterArticles.publishedAt)
        )
      )
      .groupBy(helpCenterArticles.categoryId),
  ])

  const translationByCategory = new Map(translations.map((t) => [t.categoryId, t]))
  const countByCategory = new Map(
    articleCounts.map((c) => [c.categoryId, Number(c.translatedCount)])
  )

  const visible: HelpCenterCategoryWithCount[] = []
  for (const cat of categories) {
    const translation = translationByCategory.get(cat.id)
    if (!translation || !translation.name.trim()) continue
    if ((countByCategory.get(cat.id) ?? 0) === 0) continue
    visible.push({ ...cat, name: translation.name, description: translation.description })
  }
  return visible
}

export async function getPublicCategoryBySlugForLocale(
  slug: string,
  locale: string,
  viewer: Actor = ANONYMOUS_ACTOR
): ReturnType<typeof getPublicCategoryBySlug> {
  const category = await getPublicCategoryBySlug(slug, viewer)
  if (locale === DEFAULT_LOCALE) return category

  const translation = await getCategoryTranslation(category.id as KbCategoryId, locale)
  if (!translation || !translation.name.trim()) {
    throw new NotFoundError(
      'CATEGORY_NOT_FOUND',
      `No "${locale}" translation for category "${slug}"`
    )
  }
  return { ...category, name: translation.name, description: translation.description }
}

export async function listPublicArticlesForCategoryLocale(
  categoryId: string,
  locale: string,
  viewer: Actor = ANONYMOUS_ACTOR
) {
  const articles = await listPublicArticlesForCategory(categoryId, viewer)
  if (locale === DEFAULT_LOCALE || articles.length === 0) return articles

  const translations = await db.query.helpCenterArticleTranslations.findMany({
    where: and(
      inArray(
        helpCenterArticleTranslations.articleId,
        articles.map((a) => a.id)
      ),
      eq(helpCenterArticleTranslations.locale, locale),
      eq(helpCenterArticleTranslations.status, 'published')
    ),
  })
  const byArticle = new Map(translations.map((t) => [t.articleId, t]))

  return articles
    .filter((a) => byArticle.has(a.id))
    .map((a) => {
      const translation = byArticle.get(a.id)!
      return { ...a, title: translation.title, description: translation.description }
    })
}

/**
 * Batched, locale-aware multi-category article load. Wraps
 * {@link listPublicArticlesForCategories} (one query for all categories) and,
 * for a non-default locale, applies published translations in one further query
 * across every article — instead of the previous per-category round trip. Keeps
 * the per-category grouping and the same translation semantics as
 * {@link listPublicArticlesForCategoryLocale} (untranslated articles drop out).
 */
export async function listPublicArticlesForCategoriesLocale(
  categoryIds: string[],
  locale: string,
  viewer: Actor = ANONYMOUS_ACTOR
): Promise<Map<string, PublicCategoryArticle[]>> {
  const grouped = await listPublicArticlesForCategories(categoryIds, viewer)
  if (locale === DEFAULT_LOCALE || grouped.size === 0) return grouped

  const allArticleIds: string[] = []
  for (const list of grouped.values()) for (const a of list) allArticleIds.push(a.id)
  if (allArticleIds.length === 0) return grouped

  const translations = await db.query.helpCenterArticleTranslations.findMany({
    where: and(
      inArray(helpCenterArticleTranslations.articleId, allArticleIds as KbArticleId[]),
      eq(helpCenterArticleTranslations.locale, locale),
      eq(helpCenterArticleTranslations.status, 'published')
    ),
  })
  const byArticle = new Map(translations.map((t) => [t.articleId, t]))

  const translated = new Map<string, PublicCategoryArticle[]>()
  for (const [categoryId, list] of grouped) {
    translated.set(
      categoryId,
      list
        .filter((a) => byArticle.has(a.id))
        .map((a) => {
          const t = byArticle.get(a.id)!
          return { ...a, title: t.title, description: t.description }
        })
    )
  }
  return translated
}

export async function getPublicArticleBySlugForLocale(
  slug: string,
  locale: string,
  viewer: Actor = ANONYMOUS_ACTOR
): Promise<HelpCenterArticleWithCategory> {
  const article = await getPublicArticleBySlug(slug, viewer)
  if (locale === DEFAULT_LOCALE) return article

  const translation = await getPublishedArticleTranslation(article.id as KbArticleId, locale)
  if (!translation) {
    throw new NotFoundError(
      'ARTICLE_NOT_FOUND',
      `No published "${locale}" translation for article "${slug}"`
    )
  }
  return {
    ...article,
    title: translation.title,
    description: translation.description,
    content: translation.content,
    contentJson: translation.contentJson ?? article.contentJson,
  }
}
