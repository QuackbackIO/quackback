/**
 * Per-teammate preferences that live on the `user` row but aren't part of
 * the shared profile (name/avatar) in user.ts -- kept in their own module so
 * future preferences (P2-D inbox translation and beyond) have a home that
 * isn't the general profile file.
 *
 * Both functions below are self-scoped: `requireAuth()` establishes the
 * caller's identity (any authenticated teammate, no permission check --
 * "manage your own preference" isn't a permission the RBAC catalogue
 * models), and every query is filtered to that caller's own `user.id`. There
 * is no path from the request body to a different user's row.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from './auth-helpers'
import { withErrorLog } from './with-error-log'
import { db, user, eq } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'teammate-preferences' })

// ============================================
// Schemas
// ============================================

/**
 * Loose BCP-47 language-tag shape check: a 2-3 letter primary subtag
 * followed by zero or more hyphenated subtags (script/region/variant), e.g.
 * "en", "fr", "pt-BR", "zh-Hans-CN". Deliberately not validated against a
 * fixed catalogue -- inbox translation needs to support any language a
 * teammate might read, not just the languages the product UI itself ships
 * translations for.
 */
const BCP47_TAG_REGEX = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

export const setMyLanguagePreferenceSchema = z.object({
  language: z
    .string()
    .regex(BCP47_TAG_REGEX, 'Language must be a valid BCP-47 tag (e.g. "en", "fr", "pt-BR")')
    .nullable(),
})

export type SetMyLanguagePreferenceInput = z.infer<typeof setMyLanguagePreferenceSchema>

export interface MyLanguagePreference {
  language: string | null
}

// ============================================
// Server Functions
// ============================================

/**
 * Get the current teammate's language preference. Self-scoped: reads only
 * the caller's own `user` row.
 */
export const getMyLanguagePreferenceFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<MyLanguagePreference> => {
    log.debug('get my language preference')
    return withErrorLog(log, 'get my language preference', async () => {
      const auth = await requireAuth()

      const record = await db.query.user.findFirst({
        where: eq(user.id, auth.user.id),
        columns: { preferredLanguage: true },
      })

      return { language: record?.preferredLanguage ?? null }
    })
  }
)

/**
 * Set (or clear, with `language: null`) the current teammate's language
 * preference. Self-scoped: the row updated is always the caller's own --
 * `userId` comes from the auth context, never from the request body.
 */
export const setMyLanguagePreferenceFn = createServerFn({ method: 'POST' })
  .validator(setMyLanguagePreferenceSchema)
  .handler(
    async ({ data }: { data: SetMyLanguagePreferenceInput }): Promise<MyLanguagePreference> => {
      log.debug('set my language preference')
      return withErrorLog(log, 'set my language preference', async () => {
        const auth = await requireAuth()

        const [updated] = await db
          .update(user)
          .set({ preferredLanguage: data.language })
          .where(eq(user.id, auth.user.id))
          .returning({ preferredLanguage: user.preferredLanguage })

        log.info({ user_id: auth.user.id, language: data.language }, 'language preference updated')
        return { language: updated?.preferredLanguage ?? null }
      })
    }
  )
