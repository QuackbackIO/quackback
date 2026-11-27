import type { SupportedLocale } from './i18n'

/** Each language the product has, named in itself, for a person who cannot read the page's language. */
export const LOCALE_NATIVE_NAMES: Record<SupportedLocale, string> = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  ar: 'العربية',
  ru: 'Русский',
  'pt-br': 'Português (Brasil)',
  'zh-cn': '简体中文',
  'zh-tw': '繁體中文',
  nl: 'Nederlands',
  pl: 'Polski',
  th: 'ภาษาไทย',
  uk: 'Українська',
}

/** Each language the product has, named in English, shown beside its own name. */
export const LOCALE_ENGLISH_NAMES: Record<SupportedLocale, string> = {
  en: 'English',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  ar: 'Arabic',
  ru: 'Russian',
  'pt-br': 'Portuguese',
  'zh-cn': 'Chinese (Simplified)',
  'zh-tw': 'Chinese (Traditional)',
  nl: 'Dutch',
  pl: 'Polish',
  th: 'Thai',
  uk: 'Ukrainian',
}

/** The order a person picks a language in: Latin script first, then the others. */
export const LOCALE_PICKER_ORDER: readonly SupportedLocale[] = [
  'en',
  'de',
  'es',
  'fr',
  'nl',
  'pl',
  'pt-br',
  'ru',
  'uk',
  'ar',
  'th',
  'zh-cn',
  'zh-tw',
]
