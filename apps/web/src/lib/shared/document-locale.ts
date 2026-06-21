import { DEFAULT_LOCALE, isRtlLocale, isRtlForced, type SupportedLocale } from './i18n'

// The portal layout route. Every page rendered under it (`/`, `/hc`, `/roadmap`,
// `/settings`, ...) is wrapped in PortalIntlProvider, so it's localized.
const PORTAL_LAYOUT_ROUTE_ID = '/_portal'

// Standalone routes (outside the portal layout) that render translated content
// from their first paint. Everything NOT in this set and NOT under the portal
// layout renders hard-coded English: the admin app, onboarding, and the auth
// utility pages like /auth/two-factor and /admin/login.
const LOCALIZED_ROUTE_IDS = new Set([
  '/auth/login',
  '/auth/signup',
  '/auth/recovery',
  '/auth/reset-password',
  '/widget',
])

/**
 * The locale the SSR document's `<html lang>`/`dir` should advertise, decided
 * from the matched route IDs rather than the pathname: the path can't tell a
 * localized portal page (`/hc`) from an English standalone one (`/help`), or a
 * localized `/auth/login` from an English `/auth/two-factor`. Mislabeling an
 * English page (e.g. `lang="ar" dir="rtl"`) is worse than the gap it fixes, so
 * only known-localized routes get the resolved locale; everything else stays on
 * the default.
 */
export function documentLocale(
  routeIds: readonly string[],
  resolved: SupportedLocale
): SupportedLocale {
  const localized =
    routeIds.includes(PORTAL_LAYOUT_ROUTE_ID) || routeIds.some((id) => LOCALIZED_ROUTE_IDS.has(id))
  return localized ? resolved : DEFAULT_LOCALE
}

/**
 * The `<html lang>`/`dir` attributes for a locale. `lang` is a canonical BCP-47
 * tag — our locale ids are lowercase (e.g. `zh-cn`), so the region subtag is
 * upper-cased (`zh-CN`, `pt-BR`). `dir` honors the `?rtl=1` debug override.
 * Shared by the root document (SSR) and the widget so both format identically.
 */
export function htmlLangDir(locale: SupportedLocale): { lang: string; dir: 'ltr' | 'rtl' } {
  const [language, region] = locale.split('-')
  return {
    lang: region ? `${language}-${region.toUpperCase()}` : language,
    dir: isRtlForced() || isRtlLocale(locale) ? 'rtl' : 'ltr',
  }
}
