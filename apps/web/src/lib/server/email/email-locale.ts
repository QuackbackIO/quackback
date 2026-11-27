/**
 * The language an email is written in, and its words in that language.
 *
 * Each email resolves its reader's language with the email order of
 * `resolvePersonLocale`: the language the person chose, then (customers only)
 * the main language when the workspace shows it to every visitor, then the
 * browser language of the request the email answers (sign-in links, password
 * resets, address checks), then the language detected at their latest
 * sign-in, the sign-in provider's language, the main language, English.
 * The words come from the app's own catalogues, so an email speaks the
 * language the product does; words people wrote are passed through as
 * written.
 */
import { createIntl } from 'react-intl'
import type { PrincipalId, UserId } from '@quackback/ids'
import type { EmailLocale } from '@quackback/email'
import {
  DEFAULT_LOCALE,
  everyoneLocale,
  loadMessages,
  resolvePersonLocale,
  type SupportedLocale,
} from '@/lib/shared/i18n'
import { htmlLangDir } from '@/lib/shared/document-locale'
import { isTeamMember } from '@/lib/shared/roles'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'email-locale' })

const locales = new Map<SupportedLocale, Promise<EmailLocale>>()

/** An email's words in one language, formatted from the app's catalogue. */
export function emailLocaleFor(locale: SupportedLocale): Promise<EmailLocale> {
  let cached = locales.get(locale)
  if (!cached) {
    cached = loadMessages(locale).then((messages) => {
      const intl = createIntl({ locale, messages, onError: () => {} })
      const { lang, dir } = htmlLangDir(locale)
      return {
        lang,
        dir,
        t: (message, values) => intl.formatMessage(message, values),
      } satisfies EmailLocale
    })
    // A failed load is not kept, so the next email tries again.
    cached.catch(() => locales.delete(locale))
    locales.set(locale, cached)
  }
  return cached
}

/** Who the email is for: a principal, a user, or an address that may have an account. */
export interface EmailReader {
  principalId?: PrincipalId | string | null
  userId?: UserId | string | null
  email?: string | null
}

interface ReaderFacts {
  chosen: string | null
  detected: string | null
  accountLocale: string | null
  teammate: boolean
}

async function readerFacts(reader: EmailReader): Promise<ReaderFacts | null> {
  const { db, eq, principal, user, sql } = await import('@/lib/server/db')
  const columns = {
    chosen: user.preferredLanguage,
    detected: user.detectedLocale,
    accountLocale: user.locale,
    role: principal.role,
  }
  const where = reader.principalId
    ? eq(principal.id, reader.principalId as PrincipalId)
    : reader.userId
      ? eq(user.id, reader.userId as UserId)
      : reader.email
        ? sql`lower(${user.email}) = ${reader.email.trim().toLowerCase()}`
        : null
  if (!where) return null
  const [row] = await db
    .select(columns)
    .from(user)
    .leftJoin(principal, eq(principal.userId, user.id))
    .where(where)
    .limit(1)
  if (!row) return null
  return {
    chosen: row.chosen,
    detected: row.detected,
    accountLocale: row.accountLocale,
    teammate: isTeamMember(row.role),
  }
}

/**
 * The language for an email to `reader`. `acceptLanguage` is the browser
 * language of the request the email answers, when it answers one. Never
 * throws: a person who cannot be read gets the workspace's steps (the main
 * language), and settings that cannot be read leave the person's own steps,
 * then English.
 */
export async function recipientLocale(
  reader: EmailReader,
  opts: { acceptLanguage?: string | null } = {}
): Promise<SupportedLocale> {
  try {
    const { getLanguageConfig } = await import('@/lib/server/domains/settings/settings.service')
    const [language, facts] = await Promise.all([
      getLanguageConfig().catch((error: unknown) => {
        log.warn({ err: error }, 'language settings unreadable for an email')
        return null
      }),
      readerFacts(reader).catch((error: unknown) => {
        log.warn({ err: error }, "email reader's language unreadable")
        return null
      }),
    ])
    return resolvePersonLocale({
      chosen: facts?.chosen,
      // "For everyone" is the visitors' rule; a teammate is never a visitor.
      everyone: facts?.teammate || !language ? null : everyoneLocale(language),
      acceptLanguage: opts.acceptLanguage,
      detected: facts?.detected,
      accountLocale: facts?.accountLocale,
      mainLanguage: language?.mainLanguage,
    })
  } catch (error) {
    log.warn({ err: error }, 'email language unreadable; using English')
    return DEFAULT_LOCALE
  }
}

/** {@link recipientLocale}, as the words an email is written with. */
export async function recipientEmailLocale(
  reader: EmailReader,
  opts: { acceptLanguage?: string | null } = {}
): Promise<EmailLocale> {
  return emailLocaleFor(await recipientLocale(reader, opts))
}

/** The browser language of the current request, or null outside one. */
export async function requestAcceptLanguage(): Promise<string | null> {
  try {
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    return getRequestHeaders().get('accept-language')
  } catch {
    return null
  }
}
