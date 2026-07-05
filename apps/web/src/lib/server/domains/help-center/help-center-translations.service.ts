/**
 * Per-article/category translation CRUD (domains/languages §2). Default-
 * locale content stays on kb_articles/kb_categories; every additional locale
 * is a row here, independent of the base row's own publishedAt/isPublic.
 */
import {
  db,
  eq,
  and,
  helpCenterArticleTranslations,
  helpCenterCategoryTranslations,
  type TiptapContent,
} from '@/lib/server/db'
import type { KbArticleId, KbCategoryId } from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'
import type {
  HelpCenterArticleTranslation,
  HelpCenterCategoryTranslation,
  ArticleTranslationStatusEntry,
  CategoryTranslationStatusEntry,
} from './help-center.types'

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

/** Create-or-update; a fresh translation always starts as a draft. */
export async function upsertArticleTranslation(
  input: UpsertArticleTranslationInput
): Promise<HelpCenterArticleTranslation> {
  const [row] = await db
    .insert(helpCenterArticleTranslations)
    .values({
      articleId: input.articleId,
      locale: input.locale,
      title: input.title,
      description: input.description ?? null,
      content: input.content,
      contentJson: input.contentJson ?? null,
    })
    .onConflictDoUpdate({
      target: [helpCenterArticleTranslations.articleId, helpCenterArticleTranslations.locale],
      set: {
        title: input.title,
        description: input.description ?? null,
        content: input.content,
        contentJson: input.contentJson ?? null,
        updatedAt: new Date(),
      },
    })
    .returning()
  return row
}

export async function setArticleTranslationStatus(
  articleId: KbArticleId,
  locale: string,
  status: 'draft' | 'published'
): Promise<HelpCenterArticleTranslation> {
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
  await db
    .delete(helpCenterArticleTranslations)
    .where(
      and(
        eq(helpCenterArticleTranslations.articleId, articleId),
        eq(helpCenterArticleTranslations.locale, locale)
      )
    )
}

/** One entry per enabled additional locale, for the admin editor's status pills. */
export async function getArticleTranslationStatuses(
  articleId: KbArticleId,
  enabledLocales: string[]
): Promise<ArticleTranslationStatusEntry[]> {
  const rows = await listArticleTranslations(articleId)
  const byLocale = new Map(rows.map((r) => [r.locale, r]))
  return enabledLocales.map((locale) => {
    const row = byLocale.get(locale)
    return {
      locale,
      status: row ? row.status : 'untranslated',
      updatedAt: row?.updatedAt ?? null,
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
