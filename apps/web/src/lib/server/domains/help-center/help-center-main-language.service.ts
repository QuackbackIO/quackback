/**
 * What a change of the workspace's main language does to the help center.
 *
 * The main language is where help center content lives: each article and
 * collection row holds its text in one language (its `locale`, the main
 * language unless a move left it in another), and every other language is a
 * translation on top. A change of main language moves content, deciding for
 * each article and collection on its own:
 *
 * - One with a version in the new language takes it as its own text, and its
 *   previous text becomes the translation in the language it was in. This
 *   holds whether or not the help center offers the new language: a
 *   language removed from the help center keeps its translations, and they
 *   are real text in it.
 * - One in the old main language with no version at all in the new one is
 *   relabelled when the help center does not offer the new language: the
 *   text stays, written in the new language all along, in the wrong slot.
 * - Everything else keeps its text and its language, and readers get it with
 *   a notice until someone translates it.
 *
 * Nothing is deleted, and no row ever ends up with a translation in its own
 * language, which its own text would hide. A row that already has one (only
 * a manual edit makes it) is left as it is.
 *
 * A published article never takes a draft translation as its text: that
 * would put unreviewed text live. It stays as it is, and the draft stays a
 * draft in the new language. The swapped-out text keeps the article's
 * publish state, so a published article keeps a published translation.
 *
 * When the new language is one of the help center's extra languages, the old
 * main language becomes an extra language, keeping its homepage words, and
 * the new one's homepage words become the main ones.
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
  notExists,
  type Database,
  type Transaction,
} from '@/lib/server/db'
import { alias } from 'drizzle-orm/pg-core'
import { markdownToTiptapJson } from '@/lib/server/markdown-tiptap'
import { logger } from '@/lib/server/logger'
import { generateArticleEmbedding } from './help-center-embedding.service'
import type { KbArticleId } from '@quackback/ids'
import type { HelpCenterConfig } from '@/lib/server/domains/settings/settings.types'
import { DEFAULT_HELP_CENTER_CONFIG } from '@/lib/server/domains/settings/settings.types'

type Executor = Database | Transaction

const log = logger.child({ component: 'help-center-main-language' })

const ownLanguageArticleTranslation = alias(
  helpCenterArticleTranslations,
  'own_language_translation'
)
const ownLanguageCategoryTranslation = alias(
  helpCenterCategoryTranslations,
  'own_language_category_translation'
)

/** The article already has a translation in its own language (see the module doc). */
function articleHasOwnLanguageTranslation(executor: Executor) {
  return executor
    .select({ one: sql`1` })
    .from(ownLanguageArticleTranslation)
    .where(
      and(
        eq(ownLanguageArticleTranslation.articleId, helpCenterArticles.id),
        eq(ownLanguageArticleTranslation.locale, helpCenterArticles.locale)
      )
    )
}

function categoryHasOwnLanguageTranslation(executor: Executor) {
  return executor
    .select({ one: sql`1` })
    .from(ownLanguageCategoryTranslation)
    .where(
      and(
        eq(ownLanguageCategoryTranslation.categoryId, helpCenterCategories.id),
        eq(ownLanguageCategoryTranslation.locale, helpCenterCategories.locale)
      )
    )
}

/**
 * An article whose version in `to` takes the row: one with a title, never a
 * draft over a published article, and never where the row's own text would
 * have no slot to go to.
 */
function articleSwapsInto(executor: Executor, to: string) {
  return and(
    ne(helpCenterArticles.locale, to),
    sql`btrim(${helpCenterArticleTranslations.title}) <> ''`,
    or(
      isNull(helpCenterArticles.publishedAt),
      eq(helpCenterArticleTranslations.status, 'published')
    ),
    notExists(articleHasOwnLanguageTranslation(executor))
  )
}

/** A collection whose version in `to` takes the row: one with a name (see {@link articleSwapsInto}). */
function categorySwapsInto(executor: Executor, to: string) {
  return and(
    ne(helpCenterCategories.locale, to),
    sql`btrim(${helpCenterCategoryTranslations.name}) <> ''`,
    notExists(categoryHasOwnLanguageTranslation(executor))
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

/** An article in `from` with no version in `to` at all, which a relabel moves. */
function articleRelabels(executor: Executor, from: string, to: string) {
  return and(
    eq(helpCenterArticles.locale, from),
    notExists(
      executor
        .select({ one: sql`1` })
        .from(helpCenterArticleTranslations)
        .where(articleTranslationIn(to))
    )
  )
}

function categoryRelabels(executor: Executor, from: string, to: string) {
  return and(
    eq(helpCenterCategories.locale, from),
    notExists(
      executor
        .select({ one: sql`1` })
        .from(helpCenterCategoryTranslations)
        .where(categoryTranslationIn(to))
    )
  )
}

export interface MainLanguageChange {
  from: string
  to: string
  /** `to` is one of the help center's extra languages, so nothing is relabelled. */
  toIsExtraLanguage: boolean
}

/**
 * What a change would do to the content people can see (deleted items left
 * out): the articles and collections that take their version in the new
 * language, the ones relabelled, and the ones left in their own language.
 * The counts use the same rules as {@link moveHelpCenterMainLanguage}.
 */
export interface MainLanguageChangePreview {
  swappedArticles: number
  swappedCollections: number
  relabelledArticles: number
  relabelledCollections: number
  keptArticles: number
  keptCollections: number
}

export async function previewHelpCenterMainLanguage(
  executor: Executor,
  change: MainLanguageChange
): Promise<MainLanguageChangePreview> {
  const { from, to, toIsExtraLanguage } = change
  const none = { swapped: 0, relabelled: 0, kept: 0 }
  if (from === to) return previewOf(none, none)
  const liveArticle = isNull(helpCenterArticles.deletedAt)
  const liveCategory = isNull(helpCenterCategories.deletedAt)
  const relabelling = !toIsExtraLanguage
  const [[swapped], [relabelled], [notInTo], [swappedC], [relabelledC], [notInToC]] =
    await Promise.all([
      executor
        .select({ n: count() })
        .from(helpCenterArticles)
        .innerJoin(helpCenterArticleTranslations, articleTranslationIn(to))
        .where(and(liveArticle, articleSwapsInto(executor, to))),
      relabelling
        ? executor
            .select({ n: count() })
            .from(helpCenterArticles)
            .where(and(liveArticle, articleRelabels(executor, from, to)))
        : [{ n: 0 }],
      executor
        .select({ n: count() })
        .from(helpCenterArticles)
        .where(and(liveArticle, ne(helpCenterArticles.locale, to))),
      executor
        .select({ n: count() })
        .from(helpCenterCategories)
        .innerJoin(helpCenterCategoryTranslations, categoryTranslationIn(to))
        .where(and(liveCategory, categorySwapsInto(executor, to))),
      relabelling
        ? executor
            .select({ n: count() })
            .from(helpCenterCategories)
            .where(and(liveCategory, categoryRelabels(executor, from, to)))
        : [{ n: 0 }],
      executor
        .select({ n: count() })
        .from(helpCenterCategories)
        .where(and(liveCategory, ne(helpCenterCategories.locale, to))),
    ])
  return previewOf(
    { swapped: swapped.n, relabelled: relabelled.n, kept: notInTo.n - swapped.n - relabelled.n },
    {
      swapped: swappedC.n,
      relabelled: relabelledC.n,
      kept: notInToC.n - swappedC.n - relabelledC.n,
    }
  )
}

type Tally = { swapped: number; relabelled: number; kept: number }

function previewOf(articles: Tally, collections: Tally): MainLanguageChangePreview {
  return {
    swappedArticles: articles.swapped,
    swappedCollections: collections.swapped,
    relabelledArticles: articles.relabelled,
    relabelledCollections: collections.relabelled,
    keptArticles: articles.kept,
    keptCollections: collections.kept,
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
  const { from, to, toIsExtraLanguage } = change
  if (from === to) return { swappedArticleIds: [] }
  // Swaps first: a swapped row is in `to` afterwards, so the relabel never sees it.
  const swappedArticleIds = await swapArticles(tx, to)
  await swapCategories(tx, to)
  if (!toIsExtraLanguage) {
    await tx
      .update(helpCenterArticles)
      .set({ locale: to })
      .where(articleRelabels(tx, from, to))
    await tx
      .update(helpCenterCategories)
      .set({ locale: to })
      .where(categoryRelabels(tx, from, to))
  }
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
    .where(articleSwapsInto(tx, to))
    .for('update')

  for (const row of rows) {
    const t = row.translation
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
    .where(categorySwapsInto(tx, to))
    .for('update')

  for (const row of rows) {
    const t = row.translation
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
 * The help center's settings with `to` as the main language.
 *
 * When `to` is one of the extra languages, or a removed one that kept its
 * homepage words, its homepage words become the main ones, and the old main
 * language's words are kept under its own language, with the search
 * placeholder it had there before. In a swap the old main language also
 * becomes an extra language, in the new one's place in the list, so the
 * order of the extra languages (which decides which ones a plan cap holds)
 * stays the same and a trip there and back restores it; otherwise its words
 * wait, hidden, for it to come back. The new main language keeps its search placeholder in its own
 * entry, as the main language has no placeholder of its own, so a round trip
 * loses nothing. Otherwise only the main language changes.
 */
export function helpCenterConfigForMainLanguage(
  config: HelpCenterConfig,
  to: string
): HelpCenterConfig {
  const locales = config.locales
  const from = locales.default
  if (from === to) return config
  const extra = locales.additional.includes(to)
  const { [to]: incoming, ...chrome } = locales.chrome
  if (!extra && !incoming?.homepageTitle.trim()) {
    return { ...config, locales: { ...locales, default: to } }
  }
  return {
    ...config,
    homepageTitle: incoming?.homepageTitle || DEFAULT_HELP_CENTER_CONFIG.homepageTitle,
    homepageDescription:
      incoming?.homepageDescription || DEFAULT_HELP_CENTER_CONFIG.homepageDescription,
    locales: {
      default: to,
      additional: extra ? locales.additional.map((l) => (l === to ? from : l)) : locales.additional,
      chrome: {
        ...chrome,
        ...(incoming?.searchPlaceholder
          ? {
              [to]: {
                homepageTitle: '',
                homepageDescription: '',
                searchPlaceholder: incoming.searchPlaceholder,
              },
            }
          : {}),
        // An extra language needs a homepage title.
        [from]: {
          homepageTitle: config.homepageTitle || DEFAULT_HELP_CENTER_CONFIG.homepageTitle,
          homepageDescription: config.homepageDescription,
          searchPlaceholder: chrome[from]?.searchPlaceholder ?? '',
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
