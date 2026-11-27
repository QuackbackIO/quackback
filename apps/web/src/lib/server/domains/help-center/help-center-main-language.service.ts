/**
 * What a change of the workspace's main language does to the help center.
 *
 * The main language is where help center content lives: each article and
 * collection row holds its main-language text, and every other language is a
 * translation on top. A change of main language therefore moves content:
 *
 * - To a language the help center does not offer yet: every article and
 *   collection written in the old main language is relabelled. The text
 *   stays; it was written in the new language all along, in the wrong slot.
 * - To one of the help center's extra languages: a swap. Each article and
 *   collection with a version in the new language takes it as its own text,
 *   and its previous text becomes the translation in the language it was
 *   in. One with no version there keeps its text and its language, and
 *   readers get it with a notice until someone translates it. The old main
 *   language becomes an extra language, keeping its homepage words, and the
 *   new one's homepage words become the main ones.
 *
 * A published article never takes a draft translation as its text: that
 * would put unreviewed text live. It stays as it is, and the draft stays a
 * draft in the new language. The swapped-out text keeps the article's
 * publish state, so a published article keeps a published translation.
 *
 * Everything here runs on the caller's transaction, under the settings lock
 * that also writes the new main language.
 */
import {
  db,
  and,
  count,
  inArray,
  eq,
  isNull,
  ne,
  or,
  sql,
  helpCenterArticles,
  helpCenterArticleTranslations,
  helpCenterCategories,
  helpCenterCategoryTranslations,
  type Database,
  type Transaction,
} from '@/lib/server/db'
import { markdownToTiptapJson } from '@/lib/server/markdown-tiptap'
import { logger } from '@/lib/server/logger'
import { generateArticleEmbedding } from './help-center-embedding.service'
import type { KbArticleId } from '@quackback/ids'
import type { HelpCenterConfig } from '@/lib/server/domains/settings/settings.types'
import { DEFAULT_HELP_CENTER_CONFIG } from '@/lib/server/domains/settings/settings.types'

type Executor = Database | Transaction

const log = logger.child({ component: 'help-center-main-language' })

/** An article whose version in `to` takes the row: one with a title, and never a draft over a published article. */
function articleSwapsInto(to: string) {
  return and(
    ne(helpCenterArticles.locale, to),
    sql`btrim(${helpCenterArticleTranslations.title}) <> ''`,
    or(
      isNull(helpCenterArticles.publishedAt),
      eq(helpCenterArticleTranslations.status, 'published')
    )
  )
}

/** A collection whose version in `to` takes the row: one with a name. */
function categorySwapsInto(to: string) {
  return and(
    ne(helpCenterCategories.locale, to),
    sql`btrim(${helpCenterCategoryTranslations.name}) <> ''`
  )
}

const articleTranslationIn = (to: string) =>
  and(
    eq(helpCenterArticleTranslations.articleId, helpCenterArticles.id),
    eq(helpCenterArticleTranslations.locale, to)
  )

const categoryTranslationIn = (to: string) =>
  and(
    eq(helpCenterCategoryTranslations.categoryId, helpCenterCategories.id),
    eq(helpCenterCategoryTranslations.locale, to)
  )

export interface MainLanguageChange {
  from: string
  to: string
  /** `to` is one of the help center's extra languages. */
  swap: boolean
}

/**
 * What a change would do to the content people can see (deleted items left
 * out). `articles` and `collections` are the ones relabelled, or, in a swap,
 * the ones that take their version in the new language; `keptArticles` and
 * `keptCollections` are the ones a swap leaves in their own language. The
 * counts use the same rules as {@link moveHelpCenterMainLanguage}.
 */
export interface MainLanguageChangePreview {
  swap: boolean
  articles: number
  collections: number
  keptArticles: number
  keptCollections: number
}

export async function previewHelpCenterMainLanguage(
  executor: Executor,
  change: MainLanguageChange
): Promise<MainLanguageChangePreview> {
  const { from, to, swap } = change
  if (from === to) {
    return { swap: false, articles: 0, collections: 0, keptArticles: 0, keptCollections: 0 }
  }
  const liveArticle = isNull(helpCenterArticles.deletedAt)
  const liveCategory = isNull(helpCenterCategories.deletedAt)
  if (!swap) {
    const [[articles], [collections]] = await Promise.all([
      executor
        .select({ n: count() })
        .from(helpCenterArticles)
        .where(and(liveArticle, eq(helpCenterArticles.locale, from))),
      executor
        .select({ n: count() })
        .from(helpCenterCategories)
        .where(and(liveCategory, eq(helpCenterCategories.locale, from))),
    ])
    return {
      swap,
      articles: articles.n,
      collections: collections.n,
      keptArticles: 0,
      keptCollections: 0,
    }
  }
  const [[swapped], [notInTo], [swappedCollections], [collectionsNotInTo]] = await Promise.all([
    executor
      .select({ n: count() })
      .from(helpCenterArticles)
      .innerJoin(helpCenterArticleTranslations, articleTranslationIn(to))
      .where(and(liveArticle, articleSwapsInto(to))),
    executor
      .select({ n: count() })
      .from(helpCenterArticles)
      .where(and(liveArticle, ne(helpCenterArticles.locale, to))),
    executor
      .select({ n: count() })
      .from(helpCenterCategories)
      .innerJoin(helpCenterCategoryTranslations, categoryTranslationIn(to))
      .where(and(liveCategory, categorySwapsInto(to))),
    executor
      .select({ n: count() })
      .from(helpCenterCategories)
      .where(and(liveCategory, ne(helpCenterCategories.locale, to))),
  ])
  return {
    swap,
    articles: swapped.n,
    collections: swappedCollections.n,
    keptArticles: notInTo.n - swapped.n,
    keptCollections: collectionsNotInTo.n - swappedCollections.n,
  }
}

/**
 * Move the help center's content to a new main language (see the module
 * doc). Returns the articles whose text changed, whose search embeddings the
 * caller refreshes after the transaction commits.
 */
export async function moveHelpCenterMainLanguage(
  tx: Executor,
  change: MainLanguageChange
): Promise<{ swappedArticleIds: KbArticleId[] }> {
  const { from, to, swap } = change
  if (from === to) return { swappedArticleIds: [] }
  if (!swap) {
    await tx
      .update(helpCenterArticles)
      .set({ locale: to })
      .where(eq(helpCenterArticles.locale, from))
    await tx
      .update(helpCenterCategories)
      .set({ locale: to })
      .where(eq(helpCenterCategories.locale, from))
    return { swappedArticleIds: [] }
  }
  const swappedArticleIds = await swapArticles(tx, to)
  await swapCategories(tx, to)
  return { swappedArticleIds }
}

async function swapArticles(tx: Executor, to: string): Promise<KbArticleId[]> {
  const rows = await tx
    .select({
      id: helpCenterArticles.id,
      locale: helpCenterArticles.locale,
      title: helpCenterArticles.title,
      description: helpCenterArticles.description,
      content: helpCenterArticles.content,
      contentJson: helpCenterArticles.contentJson,
      publishedAt: helpCenterArticles.publishedAt,
      updatedAt: helpCenterArticles.updatedAt,
      translation: {
        id: helpCenterArticleTranslations.id,
        title: helpCenterArticleTranslations.title,
        description: helpCenterArticleTranslations.description,
        content: helpCenterArticleTranslations.content,
        contentJson: helpCenterArticleTranslations.contentJson,
        updatedAt: helpCenterArticleTranslations.updatedAt,
      },
    })
    .from(helpCenterArticles)
    .innerJoin(helpCenterArticleTranslations, articleTranslationIn(to))
    .where(articleSwapsInto(to))
    .for('update')

  for (const row of rows) {
    const t = row.translation
    // A translation in the article's own language is shadowed by the
    // article's text, which is what readers of that language see; the
    // article's text takes its place.
    await tx
      .delete(helpCenterArticleTranslations)
      .where(
        and(
          eq(helpCenterArticleTranslations.articleId, row.id),
          eq(helpCenterArticleTranslations.locale, row.locale),
          ne(helpCenterArticleTranslations.id, t.id)
        )
      )
    // Each text keeps the time it was last written.
    await tx
      .update(helpCenterArticleTranslations)
      .set({
        locale: row.locale,
        title: row.title,
        description: row.description,
        content: row.content,
        contentJson: row.contentJson ?? markdownToTiptapJson(row.content),
        status: row.publishedAt ? 'published' : 'draft',
        updatedAt: row.updatedAt,
      })
      .where(eq(helpCenterArticleTranslations.id, t.id))
    await tx
      .update(helpCenterArticles)
      .set({
        locale: to,
        title: t.title,
        description: t.description,
        content: t.content,
        contentJson: t.contentJson ?? markdownToTiptapJson(t.content),
        updatedAt: t.updatedAt,
      })
      .where(eq(helpCenterArticles.id, row.id))
  }
  return rows.map((r) => r.id)
}

async function swapCategories(tx: Executor, to: string): Promise<void> {
  const rows = await tx
    .select({
      id: helpCenterCategories.id,
      locale: helpCenterCategories.locale,
      name: helpCenterCategories.name,
      description: helpCenterCategories.description,
      updatedAt: helpCenterCategories.updatedAt,
      translation: {
        id: helpCenterCategoryTranslations.id,
        name: helpCenterCategoryTranslations.name,
        description: helpCenterCategoryTranslations.description,
        updatedAt: helpCenterCategoryTranslations.updatedAt,
      },
    })
    .from(helpCenterCategories)
    .innerJoin(helpCenterCategoryTranslations, categoryTranslationIn(to))
    .where(categorySwapsInto(to))
    .for('update')

  for (const row of rows) {
    const t = row.translation
    await tx
      .delete(helpCenterCategoryTranslations)
      .where(
        and(
          eq(helpCenterCategoryTranslations.categoryId, row.id),
          eq(helpCenterCategoryTranslations.locale, row.locale),
          ne(helpCenterCategoryTranslations.id, t.id)
        )
      )
    await tx
      .update(helpCenterCategoryTranslations)
      .set({
        locale: row.locale,
        name: row.name,
        description: row.description,
        updatedAt: row.updatedAt,
      })
      .where(eq(helpCenterCategoryTranslations.id, t.id))
    await tx
      .update(helpCenterCategories)
      .set({ locale: to, name: t.name, description: t.description, updatedAt: t.updatedAt })
      .where(eq(helpCenterCategories.id, row.id))
  }
}

/**
 * The help center's settings with `to` as the main language. In a swap the
 * old main language becomes an extra language, taking the homepage words it
 * had as the main language, and `to` leaves the extra languages, its
 * homepage words becoming the main ones. Otherwise only the main language
 * changes.
 */
export function helpCenterConfigForMainLanguage(
  config: HelpCenterConfig,
  to: string
): HelpCenterConfig {
  const locales = config.locales
  const from = locales.default
  if (from === to) return config
  if (!locales.additional.includes(to)) {
    return { ...config, locales: { ...locales, default: to } }
  }
  const { [to]: incoming, ...chrome } = locales.chrome
  return {
    ...config,
    homepageTitle: incoming?.homepageTitle || DEFAULT_HELP_CENTER_CONFIG.homepageTitle,
    homepageDescription:
      incoming?.homepageDescription || DEFAULT_HELP_CENTER_CONFIG.homepageDescription,
    locales: {
      default: to,
      additional: [...locales.additional.filter((l) => l !== to), from],
      chrome: {
        ...chrome,
        // An extra language needs a homepage title.
        [from]: {
          homepageTitle: config.homepageTitle || DEFAULT_HELP_CENTER_CONFIG.homepageTitle,
          homepageDescription: config.homepageDescription,
          searchPlaceholder: '',
        },
      },
    },
  }
}

/**
 * Re-embed articles whose main-language text changed, one at a time in the
 * background, so semantic search and related articles follow the new text.
 * Runs on the global pool, so only after the move's transaction commits.
 */
export function refreshArticleEmbeddings(articleIds: KbArticleId[]): void {
  if (articleIds.length === 0) return
  void (async () => {
    const rows = await db
      .select({
        id: helpCenterArticles.id,
        title: helpCenterArticles.title,
        content: helpCenterArticles.content,
        categoryName: helpCenterCategories.name,
      })
      .from(helpCenterArticles)
      .innerJoin(helpCenterCategories, eq(helpCenterCategories.id, helpCenterArticles.categoryId))
      .where(inArray(helpCenterArticles.id, articleIds))
    for (const row of rows) {
      await generateArticleEmbedding(row.id, row.title, row.content, row.categoryName)
    }
  })().catch((err: unknown) => log.warn({ err }, 'article embedding refresh failed'))
}
