import { DEFAULT_LOCALE, resolveLocale } from './i18n'

/**
 * Returns the base path for the inline help center.
 * The help center is always served inline at /hc on the workspace's main domain.
 */
export function getHelpCenterBaseUrl(): string {
  return '/hc'
}

/**
 * Join a public numeric id and slug as `{urlId}-{slug}`.
 */
export function formatHcIdSlug(urlId: number, slug: string): string {
  const trimmed = slug.replace(/^-+|-+$/g, '')
  return trimmed ? `${urlId}-${trimmed}` : String(urlId)
}

/**
 * Split an `{urlId}-{slug}` path param. Returns null for a legacy category
 * slug like `getting-started`.
 */
export function parseHcIdSlug(param: string): { urlId: number; slug: string } | null {
  const hyphen = param.indexOf('-')
  const key = hyphen === -1 ? param : param.slice(0, hyphen)
  if (!/^[1-9]\d*$/.test(key)) return null
  const urlId = Number(key)
  if (!Number.isSafeInteger(urlId)) return null
  return { urlId, slug: hyphen === -1 ? '' : param.slice(hyphen + 1) }
}

/** Public article URL: `/hc/{locale}/articles/{urlId}-{slug}`. */
export function hcArticlePath(opts: { locale: string; urlId: number; slug: string }): string {
  return `/hc/${opts.locale}/articles/${formatHcIdSlug(opts.urlId, opts.slug)}`
}

/** Public collection URL: `/hc/{locale}/collections/{urlId}-{slug}`. */
export function hcCollectionPath(opts: { locale: string; urlId: number; slug: string }): string {
  return `/hc/${opts.locale}/collections/${formatHcIdSlug(opts.urlId, opts.slug)}`
}

/**
 * Build an /hc path for a given locale from its canonical (unprefixed) form.
 * The homepage stays unprefixed for the default locale (`/hc`); every other
 * path — including default-locale articles and collections — carries the
 * locale (`/hc/en/articles/...`).
 */
export function localizedHcPath(locale: string, path: string): string {
  const isHome = path === '/hc' || path === '/hc/'
  if (isHome) return locale === DEFAULT_LOCALE ? '/hc' : `/hc/${locale}`
  const rest = path.replace(/^\/hc/, '')
  return `/hc/${locale}${rest}`
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
