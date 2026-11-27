/**
 * Help center reads in one language. Each function takes the published,
 * public items from the main reads, which decide who can see what, and then
 * picks each item's version in the language:
 *
 * 1. the item's own text, when it is in that language (its `locale`);
 * 2. else its published translation there (for a collection, a translation
 *    with a name);
 * 3. else its own text, in the language it is written in.
 *
 * So a reader always gets an answer. A page in a language lists every article
 * and collection, and one with no version there reads in its own language.
 * Every item returned carries `locale`, the language its text is in, so a page
 * can name that language. A translation never makes visible an item the main
 * reads hide.
 *
 * The sitemap reads through the `...WithVersionIn` functions instead, which keep
 * only the items whose canonical page is in the language: a real version
 * there (rule 1 or 2), or, for the main language, own text in a language the
 * help center does not offer. In an extra language a collection must also
 * hold at least one such article directly; the main language lists every
 * collection it is canonical for, as a help center with one language does.
 */
import {
  db,
  eq,
  and,
  or,
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
import {
  listPublicCategories,
  getPublicCategoryBySlug,
  getPublicCategoryById,
  getPublicCategoryByUrlId,
} from './help-center.category.service'
import {
  listPublicArticlesForCategory,
  listPublicArticlesForCategories,
  type PublicCategoryArticle,
} from './help-center.article.query'
import {
  getPublicArticleBySlug,
  getPublicArticleById,
  getPublicArticleByUrlId,
} from './help-center.article.service'
import {
  getPublishedArticleTranslation,
  getCategoryTranslation,
} from './help-center-translations.service'
import type { TiptapContent } from '@/lib/server/db'
import { markdownToTiptapJson } from '@/lib/server/markdown-tiptap'
import type { RelatedArticle } from './help-center-related.service'
import type {
  HelpCenterCategory,
  HelpCenterCategoryWithCount,
  HelpCenterArticleWithCategory,
} from './help-center.types'

/**
 * A translation's rich body. A translation written as Markdown only (no
 * stored rich body) is converted, so a reader never sees the main-language
 * body under a translated title.
 */
function translationBody(translation: {
  content: string
  contentJson: TiptapContent | null
}): TiptapContent {
  return translation.contentJson ?? markdownToTiptapJson(translation.content)
}

type ListedArticle = { id: string; locale: string; title: string; description: string | null }
type ListedCategory = { id: string; locale: string; name: string; description: string | null }
type ArticleText = { title: string; description: string | null }
type CategoryText = { name: string; description: string | null }

/** Published translations in `locale`, by article, of the articles not already in it. */
async function publishedArticleTranslations(
  items: ListedArticle[],
  locale: string
): Promise<Map<string, ArticleText>> {
  const ids = items.filter((a) => a.locale !== locale).map((a) => a.id as KbArticleId)
  if (ids.length === 0) return new Map()
  const rows = await db.query.helpCenterArticleTranslations.findMany({
    where: and(
      inArray(helpCenterArticleTranslations.articleId, ids),
      eq(helpCenterArticleTranslations.locale, locale),
      eq(helpCenterArticleTranslations.status, 'published')
    ),
    columns: { articleId: true, title: true, description: true },
  })
  return new Map(rows.map((t) => [t.articleId as string, t]))
}

/** Translations in `locale` that have a name, by collection, of the collections not already in it. */
async function namedCategoryTranslations(
  items: ListedCategory[],
  locale: string
): Promise<Map<string, CategoryText>> {
  const ids = items.filter((c) => c.locale !== locale).map((c) => c.id as KbCategoryId)
  if (ids.length === 0) return new Map()
  const rows = await db.query.helpCenterCategoryTranslations.findMany({
    where: and(
      inArray(helpCenterCategoryTranslations.categoryId, ids),
      eq(helpCenterCategoryTranslations.locale, locale)
    ),
    columns: { categoryId: true, name: true, description: true },
  })
  return new Map(rows.filter((t) => t.name.trim()).map((t) => [t.categoryId as string, t]))
}

function articleIn<T extends ListedArticle>(
  item: T,
  translations: Map<string, ArticleText>,
  locale: string
): T {
  if (item.locale === locale) return item
  const t = translations.get(item.id)
  return t ? { ...item, title: t.title, description: t.description, locale } : item
}

function categoryIn<T extends ListedCategory>(
  item: T,
  translations: Map<string, CategoryText>,
  locale: string
): T {
  if (item.locale === locale) return item
  const t = translations.get(item.id)
  return t ? { ...item, name: t.name, description: t.description, locale } : item
}

/** Every public collection, each in its version in `locale` (see the module doc). */
export async function listPublicCategoriesWithFallback(
  locale: string,
  viewer: Actor = ANONYMOUS_ACTOR
): Promise<HelpCenterCategoryWithCount[]> {
  const categories = await listPublicCategories(viewer)
  const translations = await namedCategoryTranslations(categories, locale)
  return categories.map((cat) => categoryIn(cat, translations, locale))
}

/** The help center's languages: the main one and the extra ones it offers. */
export interface OfferedLanguages {
  main: string
  additional: readonly string[]
}

/**
 * Whether an item whose text is in `own` has its canonical page in `locale`
 * without a version there: in the main language, when the help center does
 * not offer `own`.
 */
function canonicalWithoutVersion(own: string, locale: string, languages: OfferedLanguages) {
  return locale === languages.main && own !== locale && !languages.additional.includes(own)
}

/** The public collections whose canonical page is in `locale` (see the module doc), for the sitemap. */
export async function listPublicCategoriesWithVersionIn(
  locale: string,
  languages: OfferedLanguages,
  viewer: Actor = ANONYMOUS_ACTOR
): Promise<HelpCenterCategoryWithCount[]> {
  const categories = await listPublicCategories(viewer)
  if (categories.length === 0) return []
  const translations = await namedCategoryTranslations(categories, locale)
  const canonical = categories.filter(
    (cat) =>
      cat.locale === locale ||
      translations.has(cat.id) ||
      canonicalWithoutVersion(cat.locale, locale, languages)
  )
  if (locale === languages.main || canonical.length === 0) {
    return canonical.map((cat) => categoryIn(cat, translations, locale))
  }
  const articleCounts = await db
    .select({ categoryId: helpCenterArticles.categoryId, inLocale: count() })
    .from(helpCenterArticles)
    .leftJoin(
      helpCenterArticleTranslations,
      and(
        eq(helpCenterArticleTranslations.articleId, helpCenterArticles.id),
        eq(helpCenterArticleTranslations.locale, locale),
        eq(helpCenterArticleTranslations.status, 'published')
      )
    )
    .where(
      and(
        inArray(
          helpCenterArticles.categoryId,
          canonical.map((c) => c.id)
        ),
        isNull(helpCenterArticles.deletedAt),
        isNotNull(helpCenterArticles.publishedAt),
        or(eq(helpCenterArticles.locale, locale), isNotNull(helpCenterArticleTranslations.id))
      )
    )
    .groupBy(helpCenterArticles.categoryId)
  const countByCategory = new Map(articleCounts.map((c) => [c.categoryId, Number(c.inLocale)]))
  return canonical
    .filter((cat) => (countByCategory.get(cat.id) ?? 0) > 0)
    .map((cat) => categoryIn(cat, translations, locale))
}

async function categoryVersionIn<T extends HelpCenterCategory>(
  category: T,
  locale: string
): Promise<T> {
  if (category.locale === locale) return category
  const t = await getCategoryTranslation(category.id as KbCategoryId, locale)
  if (!t || !t.name.trim()) return category
  return { ...category, name: t.name, description: t.description, locale }
}

export async function getPublicCategoryByUrlIdForLocale(
  urlId: number,
  locale: string,
  viewer: Actor = ANONYMOUS_ACTOR
): ReturnType<typeof getPublicCategoryByUrlId> {
  return categoryVersionIn(await getPublicCategoryByUrlId(urlId, viewer), locale)
}

export async function getPublicCategoryByIdForLocale(
  id: KbCategoryId,
  locale: string,
  viewer: Actor = ANONYMOUS_ACTOR
): ReturnType<typeof getPublicCategoryById> {
  return categoryVersionIn(await getPublicCategoryById(id, viewer), locale)
}

export async function getPublicCategoryBySlugForLocale(
  slug: string,
  locale: string,
  viewer: Actor = ANONYMOUS_ACTOR
): ReturnType<typeof getPublicCategoryBySlug> {
  return categoryVersionIn(await getPublicCategoryBySlug(slug, viewer), locale)
}

/** Every public article in a collection, each in its version in `locale`. */
export async function listPublicArticlesForCategoryWithFallback(
  categoryId: string,
  locale: string,
  viewer: Actor = ANONYMOUS_ACTOR
) {
  const articles = await listPublicArticlesForCategory(categoryId, viewer)
  const translations = await publishedArticleTranslations(articles, locale)
  return articles.map((a) => articleIn(a, translations, locale))
}

/**
 * The articles among `articles` whose canonical page is in `locale` (see the
 * module doc), for the sitemap. One query reads which articles have a
 * published translation in `locale`, however many articles there are.
 */
export async function articlesWithVersionIn<T extends { id: string; locale: string }>(
  articles: readonly T[],
  locale: string,
  languages: OfferedLanguages
): Promise<T[]> {
  const rows = await db
    .select({ articleId: helpCenterArticleTranslations.articleId })
    .from(helpCenterArticleTranslations)
    .where(
      and(
        eq(helpCenterArticleTranslations.locale, locale),
        eq(helpCenterArticleTranslations.status, 'published')
      )
    )
  const translated = new Set<string>(rows.map((r) => r.articleId))
  return articles.filter(
    (a) =>
      a.locale === locale ||
      translated.has(a.id) ||
      canonicalWithoutVersion(a.locale, locale, languages)
  )
}

/**
 * The public articles of several collections in one query (see
 * {@link listPublicArticlesForCategories}), each in its version in `locale`,
 * with one further query for every translation.
 */
export async function listPublicArticlesForCategoriesWithFallback(
  categoryIds: string[],
  locale: string,
  viewer: Actor = ANONYMOUS_ACTOR
): Promise<Map<string, PublicCategoryArticle[]>> {
  const grouped = await listPublicArticlesForCategories(categoryIds, viewer)
  const translations = await publishedArticleTranslations([...grouped.values()].flat(), locale)
  const localized = new Map<string, PublicCategoryArticle[]>()
  for (const [categoryId, list] of grouped) {
    localized.set(
      categoryId,
      list.map((a) => articleIn(a, translations, locale))
    )
  }
  return localized
}

async function articleVersionIn(
  article: HelpCenterArticleWithCategory,
  locale: string
): Promise<HelpCenterArticleWithCategory> {
  if (article.locale === locale) return article
  const t = await getPublishedArticleTranslation(article.id as KbArticleId, locale)
  if (!t) return article
  return {
    ...article,
    title: t.title,
    description: t.description,
    content: t.content,
    contentJson: translationBody(t),
    locale,
  }
}

export async function getPublicArticleByUrlIdForLocale(
  urlId: number,
  locale: string,
  viewer: Actor = ANONYMOUS_ACTOR
): Promise<HelpCenterArticleWithCategory> {
  return articleVersionIn(await getPublicArticleByUrlId(urlId, viewer), locale)
}

export async function getPublicArticleByIdForLocale(
  id: KbArticleId,
  locale: string,
  viewer: Actor = ANONYMOUS_ACTOR
): Promise<HelpCenterArticleWithCategory> {
  return articleVersionIn(await getPublicArticleById(id, viewer), locale)
}

export async function getPublicArticleBySlugForLocale(
  slug: string,
  locale: string,
  viewer: Actor = ANONYMOUS_ACTOR
): Promise<HelpCenterArticleWithCategory> {
  return articleVersionIn(await getPublicArticleBySlug(slug, viewer), locale)
}

/** Related articles for a page in `locale`, each in its version there. */
export async function localizeRelatedArticles(
  related: RelatedArticle[],
  locale: string
): Promise<RelatedArticle[]> {
  const translations = await publishedArticleTranslations(related, locale)
  return related.map((a) => articleIn(a, translations, locale))
}
