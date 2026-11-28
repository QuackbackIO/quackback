/**
 * The help-center auto-translate queue's name and the one operation other
 * help-center modules need on it: dropping auto-translate jobs that a
 * person's own change has made obsolete. A leaf module, so the translation
 * and article services can call it without importing the job handler.
 */
import { db, sql } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'

/** The logical queue name. Matches the definition in `jobs/definitions.ts`. */
export const HELP_CENTER_TRANSLATE_QUEUE = 'help-center-translate'

/**
 * Remove pending auto-translate jobs for an article (one locale, or all of
 * them). Called on every manual translation change and when the article is
 * deleted, so a job parked at the AI allowance can never later replace what
 * a person wrote. Running jobs are left alone; they re-check before writing.
 */
export async function cancelPendingAutoTranslations(
  articleId: string,
  locale?: string
): Promise<void> {
  await db.execute(sql`
    DELETE FROM job_queue
    WHERE queue = ${HELP_CENTER_TRANSLATE_QUEUE}
      AND status = 'pending'
      AND payload->>'articleId' = ${articleId}
      ${locale === undefined ? sql`` : sql`AND payload->>'locale' = ${locale}`}
  `)
}

/**
 * Automatic translation upkeep after an article was published or its text
 * changed: fire-and-forget, off by default (see help-center-translation-upkeep.ts).
 */
export function queueUpkeep(article: {
  id: string
  locale: string
  textRevision: number
  publishedAt: Date | null
}): void {
  import('./help-center-translation-upkeep')
    .then((m) => m.queueTranslationUpkeep(article))
    .catch((err) =>
      logger.error({ article_id: article.id, err }, 'translation upkeep import failed')
    )
}
