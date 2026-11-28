import { normalizeLocale, type SupportedLocale } from './i18n'

/** Each product language named in English, as a model is told it. */
const ENGLISH_NAMES: Record<SupportedLocale, string> = {
  en: 'English',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  ar: 'Arabic',
  ru: 'Russian',
  'pt-br': 'Brazilian Portuguese',
  'zh-cn': 'Simplified Chinese',
  'zh-tw': 'Traditional Chinese',
  nl: 'Dutch',
  pl: 'Polish',
  th: 'Thai',
  uk: 'Ukrainian',
}

/** A language's English name; English for one the product does not have. */
export function englishLanguageName(locale: string | null | undefined): string {
  return ENGLISH_NAMES[(locale ? normalizeLocale(locale) : null) ?? 'en']
}
