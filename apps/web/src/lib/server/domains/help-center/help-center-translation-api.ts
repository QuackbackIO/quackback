/**
 * Article and collection translations for the REST API and MCP. The same
 * service functions as the editor, with the same checks: a language the plan
 * holds back cannot be changed, and an item cannot be translated into its own
 * language.
 */
import type { KbArticleId, KbCategoryId } from '@quackback/ids'
import { ValidationError } from '@/lib/shared/errors'
import { SUPPORTED_LOCALES } from '@/lib/shared/i18n'
import { contentJsonToMarkdown, markdownToTiptapJson } from '@/lib/server/markdown-tiptap'
import { assertHelpCenterLocaleEditable } from '@/lib/server/domains/plan-limits/plan-limits.locales'
import { getHelpCenterConfig } from '@/lib/server/domains/settings/settings.service'
import {
  assertNotOwnLanguage,
  deleteArticleTranslation,
  deleteCategoryTranslation,
  getArticleLocale,
  getArticleTranslation,
  getCategoryLocale,
  listArticleTranslations,
  setArticleTranslationStatus,
  translatableLocales,
  upsertArticleTranslation,
  upsertCategoryTranslation,
} from './help-center-translations.service'
import {
  discardPendingTranslationUpdate,
  getArticleSource,
  markArticleTranslationCurrent,
  publishPendingTranslationUpdate,
} from './help-center-translation-versions.service'
import type { TiptapContent } from '@/lib/server/db'
import type { HelpCenterArticleTranslation } from './help-center.types'

/** A product language, or a 400. */
export function parseTranslationLocale(raw: string): string {
  const locale = raw.toLowerCase()
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) {
    throw new ValidationError('UNSUPPORTED_LOCALE', `"${raw}" is not a supported language`)
  }
  return locale
}

/** One translation of an article, as the API lists it. */
export interface ArticleTranslationSummary {
  locale: string
  status: 'draft' | 'published'
  title: string
  updatedAt: string
  /** The article changed after this translation was made. */
  needsUpdate: boolean
  /** An AI update is waiting for review (it may have failed its checks). */
  updateReady: boolean
}

export function summarizeTranslation(
  row: HelpCenterArticleTranslation,
  articleRevision: number
): ArticleTranslationSummary {
  return {
    locale: row.locale,
    status: row.status,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
    needsUpdate: row.sourceRevision < articleRevision,
    updateReady: row.pendingTitle !== null,
  }
}

/** Every translation an article has, with whether it needs an update. */
export async function listArticleTranslationSummaries(
  articleId: KbArticleId,
  articleRevision: number
): Promise<ArticleTranslationSummary[]> {
  const rows = await listArticleTranslations(articleId)
  return rows
    .sort((a, b) => a.locale.localeCompare(b.locale))
    .map((row) => summarizeTranslation(row, articleRevision))
}

/** An article's text in one language, saying when it is the article's own text instead. */
export interface ArticleTextInLanguage {
  locale: string
  requestedLocale: string
  /** True when the article has no version in the requested language a reader would get. */
  fallback: boolean
  title: string
  description: string | null
  /** Markdown. */
  content: string
}

/**
 * The article's text in `locale`: its translation when there is one a reader
 * gets (published), or any translation for a caller that manages the help
 * center; otherwise the article's own text, marked as the fallback.
 */
export async function readArticleInLanguage(
  article: {
    id: KbArticleId
    locale: string
    title: string
    description: string | null
    content: string
    contentJson: unknown
  },
  requested: string,
  opts: { includeDrafts: boolean }
): Promise<ArticleTextInLanguage> {
  const own = {
    locale: article.locale,
    requestedLocale: requested,
    title: article.title,
    description: article.description,
    content: contentJsonToMarkdown(article.contentJson as never, article.content),
  }
  if (requested === article.locale) return { ...own, fallback: false }
  const row = await getArticleTranslation(article.id, requested)
  if (!row || (!opts.includeDrafts && row.status !== 'published')) {
    return { ...own, fallback: true }
  }
  return {
    locale: requested,
    requestedLocale: requested,
    fallback: false,
    title: row.title,
    description: row.description,
    content: contentJsonToMarkdown(row.contentJson, row.content),
  }
}

async function editableArticleLanguage(articleId: KbArticleId, locale: string): Promise<void> {
  await assertHelpCenterLocaleEditable(locale)
  assertNotOwnLanguage(await getArticleLocale(articleId), locale)
}

/**
 * Write one language of an article from Markdown; the rich body is built from
 * it. A caller that keeps the stored body as it is passes its `contentJson`,
 * so embeds and sized images are not rebuilt from Markdown.
 */
export async function writeArticleTranslation(
  articleId: KbArticleId,
  locale: string,
  input: {
    title: string
    description?: string | null
    content: string
    contentJson?: TiptapContent | null
    status?: 'draft' | 'published'
  }
): Promise<ArticleTranslationSummary> {
  await editableArticleLanguage(articleId, locale)
  const row = await upsertArticleTranslation({
    articleId,
    locale,
    title: input.title,
    description: input.description ?? null,
    content: input.content,
    contentJson: input.contentJson ?? markdownToTiptapJson(input.content),
    status: input.status,
  })
  const source = await getArticleSource(articleId)
  return summarizeTranslation(row, source?.revision ?? row.sourceRevision)
}

/**
 * Publish or unpublish one language of an article. The text, and whether it
 * is up to date with the article, stay as they are.
 */
export async function setArticleLanguageStatus(
  articleId: KbArticleId,
  locale: string,
  status: 'draft' | 'published'
): Promise<ArticleTranslationSummary> {
  await editableArticleLanguage(articleId, locale)
  const row = await setArticleTranslationStatus(articleId, locale, status)
  const source = await getArticleSource(articleId)
  return summarizeTranslation(row, source?.revision ?? row.sourceRevision)
}

export async function removeArticleTranslation(
  articleId: KbArticleId,
  locale: string
): Promise<void> {
  await assertHelpCenterLocaleEditable(locale)
  await deleteArticleTranslation(articleId, locale)
}

/** Ask AI now: a draft for a missing language, an update waiting for review otherwise. */
export async function requestArticleAiTranslation(articleId: KbArticleId, locale: string) {
  await editableArticleLanguage(articleId, locale)
  const [config, own] = await Promise.all([getHelpCenterConfig(), getArticleLocale(articleId)])
  if (!translatableLocales(config.locales, own).includes(locale)) {
    throw new ValidationError(
      'LOCALE_NOT_OFFERED',
      'The help center does not offer this language. Add it under Settings first.'
    )
  }
  const { runArticleTranslation } = await import('./help-center-auto-translate.service')
  return runArticleTranslation(articleId, locale, { mode: 'request' })
}

export async function publishArticleTranslationUpdate(articleId: KbArticleId, locale: string) {
  await editableArticleLanguage(articleId, locale)
  const row = await publishPendingTranslationUpdate(articleId, locale)
  const source = await getArticleSource(articleId)
  return summarizeTranslation(row, source?.revision ?? row.sourceRevision)
}

export async function discardArticleTranslationUpdate(articleId: KbArticleId, locale: string) {
  await editableArticleLanguage(articleId, locale)
  const row = await discardPendingTranslationUpdate(articleId, locale)
  const source = await getArticleSource(articleId)
  return summarizeTranslation(row, source?.revision ?? row.sourceRevision)
}

export async function markArticleTranslationUpToDate(articleId: KbArticleId, locale: string) {
  await editableArticleLanguage(articleId, locale)
  const row = await markArticleTranslationCurrent(articleId, locale)
  return summarizeTranslation(row, row.sourceRevision)
}

/** Write a collection's name and description in one language. */
export async function writeCategoryTranslation(
  categoryId: KbCategoryId,
  locale: string,
  input: { name: string; description?: string | null }
) {
  await assertHelpCenterLocaleEditable(locale)
  assertNotOwnLanguage(await getCategoryLocale(categoryId), locale)
  const row = await upsertCategoryTranslation({
    categoryId,
    locale,
    name: input.name,
    description: input.description ?? null,
  })
  return {
    locale: row.locale,
    name: row.name,
    description: row.description,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function removeCategoryTranslation(
  categoryId: KbCategoryId,
  locale: string
): Promise<void> {
  await assertHelpCenterLocaleEditable(locale)
  await deleteCategoryTranslation(categoryId, locale)
}
