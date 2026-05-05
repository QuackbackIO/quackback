export const DEFAULT_LOCALE = 'pt' as const

export const SUPPORTED_LOCALES = ['en', 'de', 'fr', 'es', 'ar', 'ru', 'pt'] as const

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

const RTL_LOCALES = new Set(['ar', 'he', 'fa', 'ur'])

/**
 * Normalizes a locale string to a supported locale, stripping region subtags
 * and lowercasing. Returns null if the locale is not supported.
 */
export function normalizeLocale(locale: string): SupportedLocale | null {
  if (!locale) return null

  const lower = locale.toLowerCase()

  if ((SUPPORTED_LOCALES as readonly string[]).includes(lower)) {
    return lower as SupportedLocale
  }

  const parts = lower.split('-')
  if (parts.length >= 2) {
    const base = parts[0]
    if (base.length >= 2 && base.length <= 3 && /^[a-z]+$/.test(base)) {
      if ((SUPPORTED_LOCALES as readonly string[]).includes(base)) {
        return base as SupportedLocale
      }
    }
  }

  return null
}

export function resolveLocale(
  acceptLanguage: string | null | undefined,
  explicitLocale?: string
): SupportedLocale {
  if (explicitLocale) {
    const normalized = normalizeLocale(explicitLocale)
    if (normalized !== null) return normalized
  }

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

export function isRtlLocale(locale: string): boolean {
  return RTL_LOCALES.has(locale.toLowerCase())
}

export const isRtlForced = (() => {
  let cached: boolean | undefined
  return (): boolean => {
    if (cached !== undefined) return cached
    cached =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('rtl') === '1'
    return cached
  }
})()

const messageCache = new Map<SupportedLocale, Promise<Record<string, string>>>()

export function loadMessages(locale: SupportedLocale): Promise<Record<string, string>> {
  const cached = messageCache.get(locale)
  if (cached) return cached

  const promise = (async () => {
    if (locale === DEFAULT_LOCALE) {
      const messages = await import('../../locales/pt.json')
      return messages.default as Record<string, string>
    }
    try {
      const messages = await import(`../../locales/${locale}.json`)
      return messages.default as Record<string, string>
    } catch {
      const fallback = await import('../../locales/en.json')
      return fallback.default as Record<string, string>
    }
  })()

  messageCache.set(locale, promise)
  return promise
}
