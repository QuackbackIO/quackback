/**
 * A person's own language: the Language row in Preferences. Self-scoped, for
 * every signed-in person (teammate or customer): the row read and written is
 * always the caller's own, never one named by the request.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from './auth-helpers'
import {
  SUPPORTED_LOCALES,
  everyoneLocale,
  matchAcceptLanguage,
  normalizeLocale,
  resolvePersonLocale,
  type SupportedLocale,
} from '@/lib/shared/i18n'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'person-language' })

export interface MyLanguage {
  /** The language the person chose, or null for "Automatic". */
  chosen: SupportedLocale | null
  /** What "Automatic" gives on this request. */
  automatic: SupportedLocale
  /** Whether "Automatic" comes from the browser (else from the workspace). */
  automaticFromBrowser: boolean
}

export const setMyLanguageSchema = z.object({
  language: z.enum(SUPPORTED_LOCALES).nullable(),
})

/** The caller's chosen language, and what "Automatic" gives them on this request. */
export const getMyLanguageFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<MyLanguage> => {
    await requireAuth()
    const [{ getRequestHeaders }, { getLanguageConfig }, { getRequestSession }] = await Promise.all(
      [
        import('@tanstack/react-start/server'),
        import('@/lib/server/domains/settings/settings.service'),
        import('@/lib/server/auth/request-session'),
      ]
    )
    // The choice rides the session's user, which requireAuth already read.
    const [language, session] = await Promise.all([getLanguageConfig(), getRequestSession()])
    const stored = (session?.user as { preferredLanguage?: string | null } | undefined)
      ?.preferredLanguage
    const acceptLanguage = getRequestHeaders().get('accept-language')
    const everyone = everyoneLocale(language)
    return {
      chosen: stored ? normalizeLocale(stored) : null,
      automatic: resolvePersonLocale({
        everyone,
        acceptLanguage,
        mainLanguage: language.mainLanguage,
      }),
      automaticFromBrowser: !everyone && matchAcceptLanguage(acceptLanguage) !== null,
    }
  }
)

/** Set the caller's language, or clear it (null) to follow the browser again. */
export const setMyLanguageFn = createServerFn({ method: 'POST' })
  .validator(setMyLanguageSchema)
  .handler(async ({ data }): Promise<{ chosen: SupportedLocale | null }> => {
    const auth = await requireAuth()
    const { db, user, eq } = await import('@/lib/server/db')
    await db.update(user).set({ preferredLanguage: data.language }).where(eq(user.id, auth.user.id))
    log.info({ user_id: auth.user.id, language: data.language }, 'person language updated')
    return { chosen: data.language }
  })
