/**
 * Server functions for the article editor's languages: the language bar, one
 * language's text, and the update actions (mark as up to date, publish or
 * discard a waiting update, show changes, ask AI).
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { articleTranslationLocaleSchema } from '@/lib/shared/schemas/help-center'
import type { KbArticleId } from '@quackback/ids'

async function editableLanguage(data: { articleId: string; locale: string }) {
  await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
  const [{ assertHelpCenterLocaleEditable }, { getArticleLocale, assertNotOwnLanguage }] =
    await Promise.all([
      import('@/lib/server/domains/plan-limits/plan-limits.locales'),
      import('@/lib/server/domains/help-center/help-center-translations.service'),
    ])
  await assertHelpCenterLocaleEditable(data.locale)
  assertNotOwnLanguage(await getArticleLocale(data.articleId as KbArticleId), data.locale)
  return data.articleId as KbArticleId
}

/**
 * The article's languages: its own (the source), the main language, whether
 * AI translation can run, and one entry per other language of the help
 * center, in the help center's order.
 */
export const getArticleLanguagesFn = createServerFn({ method: 'GET' })
  .validator(z.object({ articleId: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    const articleId = data.articleId as KbArticleId
    const [settings, translations, versions, queue, ai] = await Promise.all([
      import('@/lib/server/domains/settings/settings.service'),
      import('@/lib/server/domains/help-center/help-center-translations.service'),
      import('@/lib/server/domains/help-center/help-center-translation-versions.service'),
      import('@/lib/server/domains/help-center/help-center-translate-queue'),
      import('@/lib/server/domains/help-center/help-center-auto-translate.service'),
    ])
    const [config, own, paused, aiAvailable] = await Promise.all([
      settings.getHelpCenterConfig(),
      translations.getArticleLocale(articleId),
      queue.listPausedTranslationLocales(articleId),
      ai.articleTranslationAiAvailable(),
    ])
    const main = config.locales.default
    const ownLocale = own ?? main
    const languages = await versions.getArticleTranslationOverview(
      articleId,
      translations.translatableLocales(config.locales, ownLocale),
      paused
    )
    return {
      ownLocale,
      mainLocale: main,
      aiAvailable,
      autoTranslate: config.autoTranslate.enabled,
      languages: languages.map((l) => ({
        ...l,
        updatedAt: l.updatedAt?.toISOString() ?? null,
        pendingUpdate: l.pendingUpdate
          ? { ...l.pendingUpdate, createdAt: l.pendingUpdate.createdAt?.toISOString() ?? null }
          : null,
      })),
    }
  })

/** One language's text for the editor, or null when the article has none in it. */
export const getArticleTranslationFn = createServerFn({ method: 'GET' })
  .validator(articleTranslationLocaleSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    const { getArticleTranslation } =
      await import('@/lib/server/domains/help-center/help-center-translations.service')
    const row = await getArticleTranslation(data.articleId as KbArticleId, data.locale)
    if (!row) return null
    return {
      locale: row.locale,
      title: row.title,
      description: row.description,
      content: row.content,
      contentJson: row.contentJson,
      status: row.status,
      updatedAt: row.updatedAt.toISOString(),
    }
  })

export const markArticleTranslationCurrentFn = createServerFn({ method: 'POST' })
  .validator(articleTranslationLocaleSchema)
  .handler(async ({ data }) => {
    const articleId = await editableLanguage(data)
    const { markArticleTranslationCurrent } =
      await import('@/lib/server/domains/help-center/help-center-translation-versions.service')
    await markArticleTranslationCurrent(articleId, data.locale)
    return { success: true }
  })

export const publishArticleTranslationUpdateFn = createServerFn({ method: 'POST' })
  .validator(articleTranslationLocaleSchema)
  .handler(async ({ data }) => {
    const articleId = await editableLanguage(data)
    const { publishPendingTranslationUpdate } =
      await import('@/lib/server/domains/help-center/help-center-translation-versions.service')
    await publishPendingTranslationUpdate(articleId, data.locale)
    return { success: true }
  })

export const discardArticleTranslationUpdateFn = createServerFn({ method: 'POST' })
  .validator(articleTranslationLocaleSchema)
  .handler(async ({ data }) => {
    const articleId = await editableLanguage(data)
    const { discardPendingTranslationUpdate } =
      await import('@/lib/server/domains/help-center/help-center-translation-versions.service')
    await discardPendingTranslationUpdate(articleId, data.locale)
    return { success: true }
  })

export const getArticleTranslationChangesFn = createServerFn({ method: 'GET' })
  .validator(articleTranslationLocaleSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    const { getArticleTranslationChanges } =
      await import('@/lib/server/domains/help-center/help-center-translation-versions.service')
    return getArticleTranslationChanges(data.articleId as KbArticleId, data.locale)
  })

/**
 * "Translate with AI" and "Update with AI": the same run as the automatic
 * upkeep, now. A missing language gets a draft; an existing one gets an
 * update waiting for review.
 */
export const requestArticleAiTranslationFn = createServerFn({ method: 'POST' })
  .validator(articleTranslationLocaleSchema)
  .handler(async ({ data }) => {
    const articleId = await editableLanguage(data)
    const { runArticleTranslation } =
      await import('@/lib/server/domains/help-center/help-center-auto-translate.service')
    const outcome = await runArticleTranslation(articleId, data.locale, { mode: 'request' })
    return outcome.kind === 'paused'
      ? { kind: 'paused' as const, pausedUntil: outcome.pausedUntil.toISOString() }
      : outcome
  })
