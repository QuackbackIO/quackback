/**
 * The help center translation events (webhooks and audit), raised by the same
 * service functions the editor, the REST API and MCP call. Best-effort: a
 * failed event never fails the change it describes.
 */
import { db, events, and, inArray, lt, eq, helpCenterArticleTranslations } from '@/lib/server/db'
import { emitBestEffort } from '@/lib/server/events/emit'
import {
  articleTranslationNeedsUpdate,
  articleTranslationPublished,
  articleTranslationUpdated,
  articleTranslationUpdateReady,
} from '@/lib/server/events/catalogue'
import type { TranslationCheckResult } from '@/lib/server/db'

const actor = { type: 'service' as const }
const context = { source: 'help_center' }

export function announceTranslationPublished(
  articleId: string,
  locale: string,
  title: string
): Promise<void> {
  return emitBestEffort(articleTranslationPublished, {
    payload: { articleId, locale, title },
    actor,
    entityId: articleId,
    context,
  })
}

export function announceTranslationUpdated(
  articleId: string,
  locale: string,
  title: string,
  status: 'draft' | 'published'
): Promise<void> {
  return emitBestEffort(articleTranslationUpdated, {
    payload: { articleId, locale, title, status },
    actor,
    entityId: articleId,
    context,
  })
}

export function announceTranslationUpdateReady(
  articleId: string,
  locale: string,
  articleRevision: number,
  check: TranslationCheckResult
): Promise<void> {
  return emitBestEffort(articleTranslationUpdateReady, {
    payload: {
      articleId,
      locale,
      articleRevision,
      checksPassed: check.ok,
      problems: check.problems,
    },
    actor,
    entityId: articleId,
    context,
  })
}

const needsUpdateKey = (articleId: string, locale: string, revision: number) =>
  `article.translation_needs_update:${articleId}:${locale}:${revision}`

/**
 * Announce each translation behind the article at `revision`, once per
 * language and revision: saving the same text again announces nothing new.
 */
export async function announceTranslationsBehind(
  articleId: string,
  revision: number
): Promise<void> {
  const behind = await db
    .select({
      locale: helpCenterArticleTranslations.locale,
      sourceRevision: helpCenterArticleTranslations.sourceRevision,
    })
    .from(helpCenterArticleTranslations)
    .where(
      and(
        eq(helpCenterArticleTranslations.articleId, articleId as never),
        lt(helpCenterArticleTranslations.sourceRevision, revision)
      )
    )
  if (behind.length === 0) return
  const keys = behind.map((t) => needsUpdateKey(articleId, t.locale, revision))
  const announced = new Set(
    (
      await db.select({ key: events.dedupeKey }).from(events).where(inArray(events.dedupeKey, keys))
    ).map((r) => r.key)
  )
  for (const t of behind) {
    const dedupeKey = needsUpdateKey(articleId, t.locale, revision)
    if (announced.has(dedupeKey)) continue
    await emitBestEffort(articleTranslationNeedsUpdate, {
      payload: {
        articleId,
        locale: t.locale,
        articleRevision: revision,
        translationRevision: t.sourceRevision,
      },
      actor,
      entityId: articleId,
      context,
      dedupeKey,
    })
  }
}
