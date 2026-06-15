import { DEFAULT_LOCALE, type SupportedLocale } from './i18n'

// The portal layout route. Every page rendered under it (`/`, `/hc`, `/roadmap`,
// `/settings`, ...) is wrapped in PortalIntlProvider, so it's localized.
const PORTAL_LAYOUT_ROUTE_ID = '/_portal'

// Standalone routes (outside the portal layout) that also render translated
// content. Everything NOT in this set and NOT under the portal layout — the
// English admin app, onboarding, and auth utility pages like /auth/two-factor —
// renders hard-coded English with no provider.
const LOCALIZED_ROUTE_IDS = new Set([
  '/auth/login',
  '/auth/signup',
  '/auth/recovery',
  '/auth/reset-password',
  '/admin/login',
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
