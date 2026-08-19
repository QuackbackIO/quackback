import { DEFAULT_LOCALE, resolveLocale } from './i18n'

/**
 * Returns the base path for the inline help center.
 * The help center is always served inline at /hc on the workspace's main domain.
 */
export function getHelpCenterBaseUrl(): string {
  return '/hc'
}

/**
 * Build an /hc path for a given locale from its canonical (default-locale,
 * unprefixed) form -- domains/languages §2: `/hc/{locale}/...`, default
 * locale stays unprefixed for URL stability. `path` must start with `/hc`.
 */
export function localizedHcPath(locale: string, path: string): string {
  if (locale === DEFAULT_LOCALE) return path
  if (path === '/hc') return `/hc/${locale}`
  return path.replace(/^\/hc/, `/hc/${locale}`)
}

/**
 * Inverse of {@link localizedHcPath}: given an actual /hc/* pathname and the
 * set of enabled additional locales, recover which locale it's in and the
 * canonical (unprefixed) path. A first segment that isn't an enabled locale
 * is treated as default-locale content (so `/hc/categories/x` is never
 * mistaken for locale "categories").
 */
export function parseHcLocalePath(
  pathname: string,
  enabledLocales: string[]
): { locale: string; canonicalPath: string } {
  const match = /^\/hc\/([^/]+)(\/.*)?$/.exec(pathname)
  if (match && enabledLocales.includes(match[1])) {
    return { locale: match[1], canonicalPath: `/hc${match[2] ?? ''}` }
  }
  return { locale: DEFAULT_LOCALE, canonicalPath: pathname }
}

/**
 * Browser-detect + manual-override resolution for the bare `/hc` entry
 * point (domains/languages §2). A manual choice (the `hc_locale` cookie,
 * set by the switcher) always wins over Accept-Language, including an
 * explicit choice to stay on the default locale. First-time visitors with
 * no cookie fall back to Accept-Language detection. Returns null when the
 * visitor should stay on the default-locale homepage.
 */
export function resolveHcLandingLocale(params: {
  cookieLocale: string | null
  acceptLanguage: string | null
  enabledAdditionalLocales: string[]
  defaultLocale: string
}): string | null {
  const { cookieLocale, acceptLanguage, enabledAdditionalLocales, defaultLocale } = params
  if (enabledAdditionalLocales.length === 0) return null

  if (cookieLocale) {
    if (cookieLocale === defaultLocale) return null
    return enabledAdditionalLocales.includes(cookieLocale) ? cookieLocale : null
  }

  const detected = resolveLocale(acceptLanguage)
  if (detected !== defaultLocale && enabledAdditionalLocales.includes(detected)) {
    return detected
  }
  return null
}
