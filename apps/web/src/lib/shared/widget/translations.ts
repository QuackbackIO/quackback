/**
 * Admin-provided per-locale overrides for customer-facing widget copy. The base
 * (untranslated) fields on the config stay the fallback; a locale override wins
 * when present. Kept as a small, serializable shape so the same rule runs on the
 * server (messenger welcome/offline) and the client (home greeting/subtitle).
 */
export interface WidgetContentTranslation {
  welcomeMessage?: string
  offlineMessage?: string
  greeting?: string
  subtitle?: string
}

/** Locale code -> overrides. Empty/absent means the base copy is used. */
export type WidgetTranslations = Record<string, WidgetContentTranslation>

/** Display names for admin translation pickers (widget Home + messenger). */
export const WIDGET_LOCALE_LABELS: Record<string, string> = {
  en: 'English',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  ar: 'Arabic',
  ru: 'Russian',
  'pt-br': 'Portuguese (Brazil)',
  'zh-cn': 'Chinese (Simplified)',
  'zh-tw': 'Chinese (Traditional)',
}

/**
 * The overrides that apply for `locale`: an exact match first, then the base
 * language (so `de-AT` falls back to `de`), then nothing. Callers apply the
 * result over the base field with `?? base`.
 */
export function widgetTranslationFor(
  translations: WidgetTranslations | undefined,
  locale: string | undefined | null
): WidgetContentTranslation {
  if (!translations || !locale) return {}
  return translations[locale] ?? translations[locale.split('-')[0]] ?? {}
}
