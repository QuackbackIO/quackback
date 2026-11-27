import { DEFAULT_LOCALE, normalizeLocale, type SupportedLocale } from '@/lib/shared/i18n'

function storedLanguage(json: string | null, read: (value: unknown) => unknown): string | null {
  if (!json) return null
  try {
    const value = read(JSON.parse(json))
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
}

/**
 * The main language as the settings row stores it: the language settings,
 * else the help center's default language, else English. A light read for
 * code that has the row and should not load the settings service.
 */
export function mainLanguageOfRow(row: {
  languageConfig: string | null
  helpCenterConfig?: string | null
}): SupportedLocale {
  const stored = storedLanguage(
    row.languageConfig,
    (v) => (v as { mainLanguage?: unknown } | null)?.mainLanguage
  )
  const helpDefault = storedLanguage(
    row.helpCenterConfig ?? null,
    (v) => (v as { locales?: { default?: unknown } } | null)?.locales?.default
  )
  return (
    (stored ? normalizeLocale(stored) : null) ??
    (helpDefault ? normalizeLocale(helpDefault) : null) ??
    DEFAULT_LOCALE
  )
}
