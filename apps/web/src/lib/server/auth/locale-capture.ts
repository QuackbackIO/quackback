/**
 * The detected language: the language a person's browser (or, in the widget,
 * the host page's locale) asks for, recorded on their user row at sign-in and
 * widget identify. Emails use it when the person has not chosen a language;
 * pages never read it. It comes from the request's language only, never from
 * the person's country, address or time zone.
 */
import type { UserId } from '@quackback/ids'
import { matchAcceptLanguage, normalizeLocale, type SupportedLocale } from '@/lib/shared/i18n'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'locale-capture' })

/** The host page's locale when the product has it, else the browser's, else null. */
export function detectLocale(
  acceptLanguage: string | null | undefined,
  hostLocale?: string | null
): SupportedLocale | null {
  return (hostLocale ? normalizeLocale(hostLocale) : null) ?? matchAcceptLanguage(acceptLanguage)
}

/**
 * Record a person's detected language, only when it differs from the one
 * stored (one statement, so a repeat sign-in writes nothing). Best-effort: a
 * failure is logged and never blocks the sign-in or identify around it.
 */
export async function recordDetectedLocale(
  userId: UserId,
  locale: SupportedLocale | null
): Promise<void> {
  if (!locale) return
  try {
    const { db, user, and, eq, sql } = await import('@/lib/server/db')
    await db
      .update(user)
      .set({ detectedLocale: locale, detectedLocaleAt: new Date() })
      .where(and(eq(user.id, userId), sql`${user.detectedLocale} IS DISTINCT FROM ${locale}`))
  } catch (error) {
    log.error({ err: error }, 'detected language capture failed')
  }
}

/** At a sign-in that mints a session, record the browser's language. */
export async function handleDetectedLocaleCapture(
  ctx: { context?: { newSession?: { user?: { id?: string } } | null } },
  headers: Headers
): Promise<void> {
  const userId = ctx.context?.newSession?.user?.id
  if (typeof userId !== 'string') return
  await recordDetectedLocale(userId as UserId, detectLocale(headers.get('accept-language')))
}
