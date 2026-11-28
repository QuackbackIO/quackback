/**
 * Translation versions: which translations are behind their article's text,
 * and the AI update that waits beside a translation's live text.
 *
 * Each article counts changes to its translatable text (text_revision). Each
 * translation records the revision it was made from (source_revision) and the
 * text it was made from (source_text). A translation whose source_revision is
 * lower than its article's text_revision needs an update.
 *
 * An AI update never changes the live text. It waits in the pending_* columns
 * until a person publishes it, which makes it live and current, or discards it.
 */
import {
  db,
  eq,
  and,
  isNull,
  isNotNull,
  or,
  sql,
  helpCenterArticles,
  helpCenterArticleTranslations,
  type TiptapContent,
  type TranslationCheckResult,
  type TranslationSourceText,
} from '@/lib/server/db'
import type { SQL } from 'drizzle-orm'
import type { KbArticleId } from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import type { HelpCenterArticleTranslation, TranslationStatus } from './help-center.types'

export type { TranslationCheckResult, TranslationSourceText }

/** The text of an article a translation is made from. */
export function sourceTextOf(article: {
  title: string
  description: string | null
  content: string
}): TranslationSourceText {
  return {
    title: article.title,
    description: article.description ?? null,
    content: article.content,
  }
}

/**
 * The article's text revision after an update that writes `next`: one more
 * when the title, description or body really changes, else the same. The
 * editor sends every field on each save, so a save that moves the article or
 * changes its audience leaves its translations current. Compared in the
 * UPDATE itself, against the row as it is.
 */
export function nextTextRevision(next: {
  title?: string
  description?: string | null
  content?: string
}): SQL {
  const t = helpCenterArticles
  const changes = [
    next.title !== undefined ? sql`${t.title} IS DISTINCT FROM ${next.title}` : null,
    next.description !== undefined
      ? sql`${t.description} IS DISTINCT FROM ${next.description}`
      : null,
    next.content !== undefined ? sql`${t.content} IS DISTINCT FROM ${next.content}` : null,
  ].filter((c): c is SQL => c !== null)
  if (changes.length === 0) return sql`${t.textRevision}`
  return sql`CASE WHEN ${or(...changes)} THEN ${t.textRevision} + 1 ELSE ${t.textRevision} END`
}

/** The revision and text of an article, or null when there is no live article. */
export async function getArticleSource(
  articleId: KbArticleId
): Promise<{ revision: number; text: TranslationSourceText; locale: string } | null> {
  const row = await db.query.helpCenterArticles.findFirst({
    where: and(eq(helpCenterArticles.id, articleId), isNull(helpCenterArticles.deletedAt)),
    columns: { textRevision: true, title: true, description: true, content: true, locale: true },
  })
  if (!row) return null
  return { revision: row.textRevision, text: sourceTextOf(row), locale: row.locale }
}

/** An AI update waiting beside a translation's live text. */
export interface PendingTranslationUpdate {
  /** The article revision the update was made from. */
  sourceRevision: number
  createdAt: Date | null
  /** False when the article changed again after the update was made. */
  current: boolean
  check: TranslationCheckResult | null
}

/** One language of an article, for the editor's language bar and the API. */
export interface ArticleTranslationOverview {
  locale: string
  status: TranslationStatus
  title: string | null
  updatedAt: Date | null
  /** The article changed after this translation was made. */
  needsUpdate: boolean
  pendingUpdate: PendingTranslationUpdate | null
  /** Checks on an AI draft that no person has edited yet; null otherwise. */
  draftCheck: TranslationCheckResult | null
  /** Auto-translation is waiting for AI allowance before it runs. */
  autoTranslatePaused: boolean
}

type TranslationRow = HelpCenterArticleTranslation

/** Pure: the overview of one language from its row (or none) and the article's revision. */
export function overviewOf(
  locale: string,
  row: TranslationRow | undefined,
  articleRevision: number,
  paused: boolean
): ArticleTranslationOverview {
  if (!row) {
    return {
      locale,
      status: 'untranslated',
      title: null,
      updatedAt: null,
      needsUpdate: false,
      pendingUpdate: null,
      draftCheck: null,
      autoTranslatePaused: paused,
    }
  }
  const hasPending = row.pendingTitle !== null && row.pendingSourceRevision !== null
  return {
    locale,
    status: row.status,
    title: row.title,
    updatedAt: row.updatedAt,
    needsUpdate: row.sourceRevision < articleRevision,
    pendingUpdate: hasPending
      ? {
          sourceRevision: row.pendingSourceRevision!,
          createdAt: row.pendingAt,
          current: row.pendingSourceRevision! >= articleRevision,
          check: row.checkResult,
        }
      : null,
    draftCheck: hasPending ? null : row.checkResult,
    autoTranslatePaused: paused,
  }
}

/** One entry per language in `locales`, in that order. */
export async function getArticleTranslationOverview(
  articleId: KbArticleId,
  locales: readonly string[],
  pausedLocales: readonly string[] = []
): Promise<ArticleTranslationOverview[]> {
  const [source, rows] = await Promise.all([
    getArticleSource(articleId),
    db.query.helpCenterArticleTranslations.findMany({
      where: eq(helpCenterArticleTranslations.articleId, articleId),
    }),
  ])
  if (!source) throw new NotFoundError('ARTICLE_NOT_FOUND', `Article ${articleId} not found`)
  const byLocale = new Map(rows.map((r) => [r.locale, r]))
  const paused = new Set(pausedLocales)
  return locales.map((locale) =>
    overviewOf(locale, byLocale.get(locale), source.revision, paused.has(locale))
  )
}

const clearedPending = {
  pendingTitle: null,
  pendingDescription: null,
  pendingContent: null,
  pendingContentJson: null,
  pendingSourceRevision: null,
  pendingSourceText: null,
  pendingAt: null,
  checkResult: null,
} as const

const translationIn = (articleId: KbArticleId, locale: string) =>
  and(
    eq(helpCenterArticleTranslations.articleId, articleId),
    eq(helpCenterArticleTranslations.locale, locale)
  )

/**
 * A person says the translation matches the article as it is now. It becomes
 * current, and an AI update waiting beside it is dropped: it was made to
 * bring the translation up to date, which the person has just done.
 */
export async function markArticleTranslationCurrent(
  articleId: KbArticleId,
  locale: string
): Promise<TranslationRow> {
  const source = await getArticleSource(articleId)
  if (!source) throw new NotFoundError('ARTICLE_NOT_FOUND', `Article ${articleId} not found`)
  const [row] = await db
    .update(helpCenterArticleTranslations)
    .set({
      sourceRevision: source.revision,
      sourceText: source.text,
      ...clearedPending,
      updatedAt: new Date(),
    })
    .where(translationIn(articleId, locale))
    .returning()
  if (!row) {
    throw new NotFoundError(
      'ARTICLE_TRANSLATION_NOT_FOUND',
      'This article has no translation in this language'
    )
  }
  return row
}

/**
 * Make the waiting AI update the translation's text. It keeps its publish
 * state: a published translation shows the update to readers at once. An
 * update that failed its checks is refused; a person fixes the translation
 * by hand or asks for a new update.
 */
export async function publishPendingTranslationUpdate(
  articleId: KbArticleId,
  locale: string
): Promise<TranslationRow> {
  const existing = await db.query.helpCenterArticleTranslations.findFirst({
    where: and(
      translationIn(articleId, locale),
      isNotNull(helpCenterArticleTranslations.pendingTitle)
    ),
  })
  if (!existing || existing.pendingSourceRevision === null) {
    throw new NotFoundError(
      'TRANSLATION_UPDATE_NOT_FOUND',
      'There is no update waiting for this language'
    )
  }
  if (existing.checkResult && !existing.checkResult.ok) {
    throw new ValidationError(
      'TRANSLATION_UPDATE_NEEDS_PERSON',
      'This update did not pass its checks. Edit the translation yourself or discard the update.'
    )
  }
  // One statement that copies the pending columns, so an update replaced by a
  // newer one between the read and this write publishes the newer one whole.
  const [row] = await db
    .update(helpCenterArticleTranslations)
    .set({
      title: sql`${helpCenterArticleTranslations.pendingTitle}`,
      description: sql`${helpCenterArticleTranslations.pendingDescription}`,
      content: sql`coalesce(${helpCenterArticleTranslations.pendingContent}, '')`,
      contentJson: sql`${helpCenterArticleTranslations.pendingContentJson}`,
      sourceRevision: sql`${helpCenterArticleTranslations.pendingSourceRevision}`,
      sourceText: sql`${helpCenterArticleTranslations.pendingSourceText}`,
      ...clearedPending,
      updatedAt: new Date(),
    })
    .where(
      and(
        translationIn(articleId, locale),
        isNotNull(helpCenterArticleTranslations.pendingTitle),
        isNotNull(helpCenterArticleTranslations.pendingSourceRevision),
        sql`coalesce((${helpCenterArticleTranslations.checkResult}->>'ok')::boolean, true)`
      )
    )
    .returning()
  if (!row) {
    throw new NotFoundError(
      'TRANSLATION_UPDATE_NOT_FOUND',
      'There is no update waiting for this language'
    )
  }
  return row
}

/** Drop the waiting AI update; the live text stays as it is. */
export async function discardPendingTranslationUpdate(
  articleId: KbArticleId,
  locale: string
): Promise<TranslationRow> {
  const [row] = await db
    .update(helpCenterArticleTranslations)
    .set({ ...clearedPending })
    .where(
      and(translationIn(articleId, locale), isNotNull(helpCenterArticleTranslations.pendingTitle))
    )
    .returning()
  if (!row) {
    throw new NotFoundError(
      'TRANSLATION_UPDATE_NOT_FOUND',
      'There is no update waiting for this language'
    )
  }
  return row
}

/** A translation's text, as the editor and the change view show it. */
export interface TranslationText {
  title: string
  description: string | null
  /** Markdown. */
  content: string
}

/** What "Show changes" compares for one language. */
export interface ArticleTranslationChanges {
  /**
   * The article's text when the translation was made, and now. `before` is
   * null for a translation made before versions were recorded.
   */
  source: { before: TranslationSourceText | null; after: TranslationSourceText }
  /** The live translation and the waiting update, when there is one. */
  update: { live: TranslationText; pending: TranslationText } | null
}

export async function getArticleTranslationChanges(
  articleId: KbArticleId,
  locale: string
): Promise<ArticleTranslationChanges> {
  const [source, row] = await Promise.all([
    getArticleSource(articleId),
    db.query.helpCenterArticleTranslations.findFirst({ where: translationIn(articleId, locale) }),
  ])
  if (!source) throw new NotFoundError('ARTICLE_NOT_FOUND', `Article ${articleId} not found`)
  if (!row) {
    throw new NotFoundError(
      'ARTICLE_TRANSLATION_NOT_FOUND',
      'This article has no translation in this language'
    )
  }
  return {
    source: { before: row.sourceText ?? null, after: source.text },
    update:
      row.pendingTitle !== null
        ? {
            live: { title: row.title, description: row.description, content: row.content },
            pending: {
              title: row.pendingTitle,
              description: row.pendingDescription,
              content: row.pendingContent ?? '',
            },
          }
        : null,
  }
}

/** The fields an AI update writes beside the live text. */
export interface PendingTranslationInput {
  title: string
  description: string | null
  content: string
  contentJson: TiptapContent
  sourceRevision: number
  sourceText: TranslationSourceText
  check: TranslationCheckResult
}

/**
 * Store an AI update beside an existing translation's live text. Writes
 * nothing when there is no translation, or when it already is current with
 * the revision the update was made from (a person brought it up to date while
 * the AI worked). Replaces an older waiting update. Returns whether it wrote.
 */
export async function writePendingTranslationUpdate(
  articleId: KbArticleId,
  locale: string,
  input: PendingTranslationInput
): Promise<boolean> {
  const rows = await db
    .update(helpCenterArticleTranslations)
    .set({
      pendingTitle: input.title,
      pendingDescription: input.description,
      pendingContent: input.content,
      pendingContentJson: input.contentJson,
      pendingSourceRevision: input.sourceRevision,
      pendingSourceText: input.sourceText,
      pendingAt: new Date(),
      checkResult: input.check,
    })
    .where(
      and(
        translationIn(articleId, locale),
        sql`${helpCenterArticleTranslations.sourceRevision} < ${input.sourceRevision}`
      )
    )
    .returning({ id: helpCenterArticleTranslations.id })
  return rows.length > 0
}
