/**
 * Per-article/category translation CRUD (domains/languages §2). Default-
 * locale content stays on kb_articles/kb_categories; every additional locale
 * is a row here, independent of the base row's own publishedAt/isPublic.
 */
import {
  db,
  eq,
  and,
  sql,
  helpCenterArticles,
  helpCenterArticleTranslations,
  helpCenterCategories,
  helpCenterCategoryTranslations,
  type TiptapContent,
} from '@/lib/server/db'
import type { KbArticleId, KbCategoryId } from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { markdownToTiptapJson } from '@/lib/server/markdown-tiptap'
import { cancelPendingAutoTranslations } from './help-center-translate-jobs'
import {
  getArticleSource,
  type TranslationSourceText,
} from './help-center-translation-versions.service'
import type {
  HelpCenterArticleTranslation,
  HelpCenterCategoryTranslation,
  ArticleTranslationStatusEntry,
  CategoryTranslationStatusEntry,
} from './help-center.types'

// ============================================================================
// Which languages an item can be translated into
// ============================================================================

/**
 * The language an article's own text is in, or null when there is no such
 * article. It is not always the main language: a change of main language
 * leaves an article with no version in the new one in its own.
 */
export async function getArticleLocale(articleId: KbArticleId): Promise<string | null> {
  const row = await db.query.helpCenterArticles.findFirst({
    where: eq(helpCenterArticles.id, articleId),
    columns: { locale: true },
  })
  return row?.locale ?? null
}

/** The language a collection's own name is in, or null when there is no such collection. */
export async function getCategoryLocale(categoryId: KbCategoryId): Promise<string | null> {
  const row = await db.query.helpCenterCategories.findFirst({
    where: eq(helpCenterCategories.id, categoryId),
    columns: { locale: true },
  })
  return row?.locale ?? null
}

/**
 * The help center's languages an item whose own text is in `own` can be
 * translated into: the main language and the extra ones, less its own. For an
 * item in the main language that is the extra languages.
 */
export function translatableLocales(
  languages: { default: string; additional: readonly string[] },
  own: string | null
): string[] {
  return [languages.default, ...languages.additional].filter((l) => l !== own)
}

/**
 * Refuses a translation in the item's own language. Its own text is what
 * readers of that language get, so such a translation would never show, and
 * a later change of main language could not swap the item.
 */
export function assertNotOwnLanguage(own: string | null, locale: string): void {
  if (own === locale) {
    throw new ValidationError(
      'TRANSLATION_IN_OWN_LANGUAGE',
      'This is already written in this language. Edit it directly instead of adding a translation.'
    )
  }
}

// ============================================================================
// Article translations
// ============================================================================

export interface UpsertArticleTranslationInput {
  articleId: KbArticleId
  locale: string
  title: string
  description?: string | null
  content: string
  contentJson?: TiptapContent | null
  /**
   * The article revision and text a new translation is made from. Read from
   * the article when not given. An existing translation keeps its own.
   */
  source?: { revision: number; text: TranslationSourceText }
}

/** The source a new translation records: the given one, or the article as it is now. */
async function sourceFor(input: UpsertArticleTranslationInput) {
  if (input.source) return input.source
  const article = await getArticleSource(input.articleId)
  if (!article) throw new NotFoundError('ARTICLE_NOT_FOUND', `Article ${input.articleId} not found`)
  return { revision: article.revision, text: article.text }
}

export async function listArticleTranslations(
  articleId: KbArticleId
): Promise<HelpCenterArticleTranslation[]> {
  return db.query.helpCenterArticleTranslations.findMany({
    where: eq(helpCenterArticleTranslations.articleId, articleId),
  })
}

export async function getArticleTranslation(
  articleId: KbArticleId,
  locale: string
): Promise<HelpCenterArticleTranslation | null> {
  const row = await db.query.helpCenterArticleTranslations.findFirst({
    where: and(
      eq(helpCenterArticleTranslations.articleId, articleId),
      eq(helpCenterArticleTranslations.locale, locale)
    ),
  })
  return row ?? null
}

/** Published-only read for the public /hc/{locale} site. */
export async function getPublishedArticleTranslation(
  articleId: KbArticleId,
  locale: string
): Promise<HelpCenterArticleTranslation | null> {
  const row = await getArticleTranslation(articleId, locale)
  return row && row.status === 'published' ? row : null
}

/**
 * Create-or-update a translation; a fresh one always starts as a draft. A
 * manual write (the default) is a saved draft: it also takes a published
 * translation back to draft, so the edit is not live until it is published
 * again. It also drops pending auto-translate jobs for that locale, so a job
 * parked at the AI allowance can never later replace it. Auto-translate
 * passes `source: 'auto'` and leaves the status as it is.
 */
export async function upsertArticleTranslation(
  input: UpsertArticleTranslationInput,
  opts: { source?: 'manual' | 'auto' } = {}
): Promise<HelpCenterArticleTranslation> {
  const manual = opts.source !== 'auto'
  if (manual) await cancelPendingAutoTranslations(input.articleId, input.locale)
  // The public pages render the rich body, so a Markdown-only write stores one too.
  const contentJson = input.contentJson ?? markdownToTiptapJson(input.content)
  const source = await sourceFor(input)
  const [row] = await db
    .insert(helpCenterArticleTranslations)
    .values({
      articleId: input.articleId,
      locale: input.locale,
      title: input.title,
      description: input.description ?? null,
      content: input.content,
      contentJson,
      sourceRevision: source.revision,
      sourceText: source.text,
    })
    .onConflictDoUpdate({
      target: [helpCenterArticleTranslations.articleId, helpCenterArticleTranslations.locale],
      set: {
        title: input.title,
        description: input.description ?? null,
        content: input.content,
        contentJson,
        ...(manual ? { status: 'draft' as const } : {}),
        // A person's edit is no longer the AI draft the checks were about. A
        // waiting update keeps its own result.
        ...(manual
          ? {
              checkResult: sql`CASE WHEN ${helpCenterArticleTranslations.pendingTitle} IS NULL THEN NULL ELSE ${helpCenterArticleTranslations.checkResult} END`,
            }
          : {}),
        updatedAt: new Date(),
      },
    })
    .returning()
  return row
}

/**
 * Auto-translate's write for a job parked at the AI allowance: one statement
 * that writes only if the translation is still what the job saw when parked
 * (`baselineUpdatedAt`, or no row at all when null). A person's change that
 * lands at any point before this statement wins, including a published
 * translation, which stays exactly as they left it. Returns whether a row
 * was written.
 *
 * Compared at millisecond precision because the baseline went through a JS
 * Date, which keeps only milliseconds.
 */
export async function writeGuardedArticleTranslation(
  input: UpsertArticleTranslationInput,
  baselineUpdatedAt: string | null
): Promise<boolean> {
  const source = await sourceFor(input)
  const values = {
    articleId: input.articleId,
    locale: input.locale,
    title: input.title,
    description: input.description ?? null,
    content: input.content,
    contentJson: input.contentJson ?? null,
    sourceRevision: source.revision,
    sourceText: source.text,
  }
  const insert = db.insert(helpCenterArticleTranslations).values(values)
  const rows =
    baselineUpdatedAt === null
      ? await insert.onConflictDoNothing().returning({ id: helpCenterArticleTranslations.id })
      : await insert
          .onConflictDoUpdate({
            target: [helpCenterArticleTranslations.articleId, helpCenterArticleTranslations.locale],
            set: {
              title: values.title,
              description: values.description,
              content: values.content,
              contentJson: values.contentJson,
              updatedAt: new Date(),
            },
            setWhere: sql`date_trunc('milliseconds', ${helpCenterArticleTranslations.updatedAt}) = ${baselineUpdatedAt}::timestamptz`,
          })
          .returning({ id: helpCenterArticleTranslations.id })
  return rows.length > 0
}

export async function setArticleTranslationStatus(
  articleId: KbArticleId,
  locale: string,
  status: 'draft' | 'published'
): Promise<HelpCenterArticleTranslation> {
  await cancelPendingAutoTranslations(articleId, locale)
  const [row] = await db
    .update(helpCenterArticleTranslations)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(helpCenterArticleTranslations.articleId, articleId),
        eq(helpCenterArticleTranslations.locale, locale)
      )
    )
    .returning()
  if (!row) {
    throw new NotFoundError(
      'ARTICLE_TRANSLATION_NOT_FOUND',
      'Save the translation before publishing it'
    )
  }
  return row
}

export async function deleteArticleTranslation(
  articleId: KbArticleId,
  locale: string
): Promise<void> {
  await cancelPendingAutoTranslations(articleId, locale)
  await db
    .delete(helpCenterArticleTranslations)
    .where(
      and(
        eq(helpCenterArticleTranslations.articleId, articleId),
        eq(helpCenterArticleTranslations.locale, locale)
      )
    )
}

/** One entry per language in `enabledLocales`, for the admin editor's status pills. */
export async function getArticleTranslationStatuses(
  articleId: KbArticleId,
  enabledLocales: string[],
  pausedLocales: readonly string[] = []
): Promise<ArticleTranslationStatusEntry[]> {
  const rows = await listArticleTranslations(articleId)
  const byLocale = new Map(rows.map((r) => [r.locale, r]))
  const paused = new Set(pausedLocales)
  return enabledLocales.map((locale) => {
    const row = byLocale.get(locale)
    return {
      locale,
      status: row ? row.status : 'untranslated',
      updatedAt: row?.updatedAt ?? null,
      autoTranslatePaused: paused.has(locale),
    }
  })
}

// ============================================================================
// Category translations
// ============================================================================

export interface UpsertCategoryTranslationInput {
  categoryId: KbCategoryId
  locale: string
  name: string
  description?: string | null
}

export async function listCategoryTranslations(
  categoryId: KbCategoryId
): Promise<HelpCenterCategoryTranslation[]> {
  return db.query.helpCenterCategoryTranslations.findMany({
    where: eq(helpCenterCategoryTranslations.categoryId, categoryId),
  })
}

export async function getCategoryTranslation(
  categoryId: KbCategoryId,
  locale: string
): Promise<HelpCenterCategoryTranslation | null> {
  const row = await db.query.helpCenterCategoryTranslations.findFirst({
    where: and(
      eq(helpCenterCategoryTranslations.categoryId, categoryId),
      eq(helpCenterCategoryTranslations.locale, locale)
    ),
  })
  return row ?? null
}

export async function upsertCategoryTranslation(
  input: UpsertCategoryTranslationInput
): Promise<HelpCenterCategoryTranslation> {
  const [row] = await db
    .insert(helpCenterCategoryTranslations)
    .values({
      categoryId: input.categoryId,
      locale: input.locale,
      name: input.name,
      description: input.description ?? null,
    })
    .onConflictDoUpdate({
      target: [helpCenterCategoryTranslations.categoryId, helpCenterCategoryTranslations.locale],
      set: {
        name: input.name,
        description: input.description ?? null,
        updatedAt: new Date(),
      },
    })
    .returning()
  return row
}

export async function deleteCategoryTranslation(
  categoryId: KbCategoryId,
  locale: string
): Promise<void> {
  await db
    .delete(helpCenterCategoryTranslations)
    .where(
      and(
        eq(helpCenterCategoryTranslations.categoryId, categoryId),
        eq(helpCenterCategoryTranslations.locale, locale)
      )
    )
}

/** A category is "translated" in a locale purely by having a non-empty name there. */
export async function getCategoryTranslationStatuses(
  categoryId: KbCategoryId,
  enabledLocales: string[]
): Promise<CategoryTranslationStatusEntry[]> {
  const rows = await listCategoryTranslations(categoryId)
  const byLocale = new Map(rows.map((r) => [r.locale, r]))
  return enabledLocales.map((locale) => {
    const row = byLocale.get(locale)
    const translated = !!row && row.name.trim().length > 0
    return {
      locale,
      status: translated ? 'translated' : 'untranslated',
      updatedAt: row?.updatedAt ?? null,
    }
  })
}
