/**
 * Automatic translation upkeep: when "Translate automatically" is on, a
 * published article whose text changes (or that is published) queues an AI
 * translation for each other language of the help center. The job makes a
 * draft for a missing language and an update waiting for review for one that
 * is behind; one that is current is left alone without an AI call.
 *
 * A daily catch-up queues again the translations still behind their article
 * (a failed call, a paused AI allowance). It does not fill missing languages:
 * turning the setting on does not translate the whole help center at once.
 */
import {
  db,
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  helpCenterArticles,
  helpCenterArticleTranslations,
} from '@/lib/server/db'
import { getHelpCenterConfig } from '@/lib/server/domains/settings/settings.service'
import { isFeatureLive } from '@/lib/server/domains/plan-limits/plan-limits.service'
import { logger } from '@/lib/server/logger'
import { enqueueHelpCenterTranslateJob } from './help-center-translate-queue'
import { announceTranslationsBehind } from './help-center-translation-events'

const log = logger.child({ component: 'help-center-translation-upkeep' })

/** Most translations one catch-up run queues; the next run takes the rest. */
export const CATCH_UP_BATCH = 200

/** The help center's languages an article in `own` is translated into. */
function targetLocales(
  helpCenter: Awaited<ReturnType<typeof getHelpCenterConfig>>,
  own: string | null | undefined
): string[] {
  const main = helpCenter.locales?.default
  const ownLocale = own ?? main
  return [main, ...(helpCenter.locales?.additional ?? [])].filter(
    (locale): locale is string => !!locale && locale !== ownLocale
  )
}

/** True when automatic translation should run now. */
export async function automaticTranslationOn(): Promise<boolean> {
  const helpCenter = await getHelpCenterConfig()
  if (!helpCenter.autoTranslate?.enabled) return false
  return isFeatureLive('aiArticleTranslation')
}

/**
 * Queue the upkeep of an article's translations after it was published or
 * its text changed. One job per language and article revision, so saving the
 * same text again queues nothing new. Errors are logged, never thrown: a
 * translation outage never blocks a save.
 */
export async function queueTranslationUpkeep(article: {
  id: string
  locale?: string | null
  textRevision: number
  publishedAt: Date | null
}): Promise<void> {
  await announceTranslationsBehind(article.id, article.textRevision).catch((err) =>
    log.error({ err, article_id: article.id }, 'failed to announce translations behind')
  )
  if (!article.publishedAt) return
  try {
    const helpCenter = await getHelpCenterConfig()
    if (!helpCenter.autoTranslate?.enabled) return
    if (!(await isFeatureLive('aiArticleTranslation'))) return
    const targets = targetLocales(helpCenter, article.locale)
    if (targets.length === 0) return

    await Promise.all(
      targets.map((locale) =>
        enqueueHelpCenterTranslateJob(
          { type: 'translate-article', articleId: article.id, locale },
          { dedupeKey: `upkeep:${article.id}:${locale}:${article.textRevision}` }
        )
      )
    )
  } catch (err) {
    log.error({ err, article_id: article.id }, 'failed to queue translation upkeep')
  }
}

/**
 * The daily catch-up: queue each translation of a published article that is
 * behind it and has no update waiting for, or discarded at, its current
 * version (pending_source_revision covers both). Keyed by day,
 * so a run on the next day queues an item again if it is still behind.
 */
export async function runTranslationCatchUp(now: Date = new Date()): Promise<number> {
  if (!(await automaticTranslationOn())) return 0
  const helpCenter = await getHelpCenterConfig()
  const locales = [helpCenter.locales?.default, ...(helpCenter.locales?.additional ?? [])].filter(
    (l): l is string => !!l
  )
  if (locales.length < 2) return 0

  const t = helpCenterArticleTranslations
  const a = helpCenterArticles
  const rows = await db
    .select({ articleId: t.articleId, locale: t.locale, revision: a.textRevision })
    .from(t)
    .innerJoin(a, eq(a.id, t.articleId))
    .where(
      and(
        isNull(a.deletedAt),
        isNotNull(a.publishedAt),
        ne(t.locale, a.locale),
        inArray(t.locale, locales),
        lt(t.sourceRevision, a.textRevision),
        or(isNull(t.pendingSourceRevision), lt(t.pendingSourceRevision, a.textRevision))
      )
    )
    .orderBy(desc(a.updatedAt))
    .limit(CATCH_UP_BATCH)
  if (rows.length === 0) return 0

  const day = now.toISOString().slice(0, 10)
  for (const row of rows) {
    await enqueueHelpCenterTranslateJob(
      { type: 'translate-article', articleId: row.articleId, locale: row.locale },
      { dedupeKey: `catch-up:${row.articleId}:${row.locale}:${row.revision}:${day}` }
    )
  }
  log.info({ queued: rows.length }, 'translation catch-up queued')
  return rows.length
}
