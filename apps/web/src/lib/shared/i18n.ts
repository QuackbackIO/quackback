export const DEFAULT_LOCALE = 'en' as const

export const SUPPORTED_LOCALES = ['en', 'de', 'pt', 'fr', 'es', 'it', 'ar'] as const

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

const RTL_LOCALES = new Set(['ar', 'he', 'fa', 'ur'])

/**
 * Normalizes a locale string to a supported locale, stripping region subtags
 * and lowercasing. Returns null if the locale is not supported.
 */
export function normalizeLocale(locale: string): SupportedLocale | null {
  if (!locale) return null

  const lower = locale.toLowerCase()

  // Try exact match first
  if ((SUPPORTED_LOCALES as readonly string[]).includes(lower)) {
    return lower as SupportedLocale
  }

  // Strip region subtag (e.g. "fr-FR" -> "fr"), but only accept 2-letter base codes
  const parts = lower.split('-')
  if (parts.length >= 2) {
    const base = parts[0]
    // Only treat as a locale if the base is a 2–3 letter code
    if (base.length >= 2 && base.length <= 3 && /^[a-z]+$/.test(base)) {
      if ((SUPPORTED_LOCALES as readonly string[]).includes(base)) {
        return base as SupportedLocale
      }
    }
  }

  return null
}

/**
 * Parses an Accept-Language header and returns the best matching supported
 * locale. An explicit locale override takes precedence when supported.
 * Falls back to DEFAULT_LOCALE if nothing matches.
 */
export function resolveLocale(
  acceptLanguage: string | null | undefined,
  explicitLocale?: string
): SupportedLocale {
  // Explicit locale wins if it's supported
  if (explicitLocale) {
    const normalized = normalizeLocale(explicitLocale)
    if (normalized !== null) return normalized
  }

  // Parse Accept-Language header
  if (!acceptLanguage) return DEFAULT_LOCALE

  const entries = acceptLanguage
    .split(',')
    .map((entry) => {
      const [tag, qPart] = entry.trim().split(';')
      const q = qPart ? parseFloat(qPart.replace('q=', '').trim()) : 1.0
      return { tag: tag.trim(), q: isNaN(q) ? 1.0 : q }
    })
    .sort((a, b) => b.q - a.q)

  for (const { tag } of entries) {
    const normalized = normalizeLocale(tag)
    if (normalized !== null) return normalized
  }

  return DEFAULT_LOCALE
}

/**
 * Returns true if the given locale is written right-to-left.
 */
export function isRtlLocale(locale: string): boolean {
  return RTL_LOCALES.has(locale.toLowerCase())
}

/**
 * Dynamically imports compiled message catalog for the given locale.
 * Falls back to English on error.
 */
export async function loadMessages(locale: SupportedLocale): Promise<Record<string, string>> {
  try {
    const messages = await import(`../locales/compiled/${locale}.json`)
    return messages.default as Record<string, string>
  } catch {
    if (locale !== DEFAULT_LOCALE) {
      const fallback = await import('../locales/compiled/en.json')
      return fallback.default as Record<string, string>
    }
    return {}
  }
}
