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
