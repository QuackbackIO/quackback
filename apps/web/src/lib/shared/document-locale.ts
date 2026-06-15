import { DEFAULT_LOCALE, type SupportedLocale } from './i18n'

// Routes that render in English regardless of the visitor's language: the admin
// app and the non-portal system routes. `/admin/login` is the exception — it
// renders translated like the public auth pages, so it's handled before this.
const ENGLISH_ONLY_PREFIXES = [
  '/admin',
  '/onboarding',
  '/api',
  '/complete-signup',
  '/oauth',
  '/.well-known',
]

/**
 * The locale the SSR document's `<html lang>` (and `dir`) should advertise for a
 * given path. Localized surfaces — the public portal, `/auth/*`, `/admin/login`,
 * and the widget — use the resolved locale; the English admin UI and system
 * routes stay on the default. Keeps `<html lang>` matching the rendered content
 * instead of mislabeling an English admin page with the visitor's language.
 */
export function documentLocale(pathname: string, resolved: SupportedLocale): SupportedLocale {
  if (pathname.startsWith('/admin/login')) return resolved
  if (ENGLISH_ONLY_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return DEFAULT_LOCALE
  return resolved
}
