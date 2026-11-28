import { useIntl } from 'react-intl'
import { LOCALE_NATIVE_NAMES } from '@/lib/shared/locale-names'
import type { SupportedLocale } from '@/lib/shared/i18n'

const LANGUAGE_NAMES: Record<SupportedLocale, { id: string; defaultMessage: string }> = {
  en: { id: 'admin.settings.language.name.en', defaultMessage: 'English' },
  de: { id: 'admin.settings.language.name.de', defaultMessage: 'German' },
  fr: { id: 'admin.settings.language.name.fr', defaultMessage: 'French' },
  es: { id: 'admin.settings.language.name.es', defaultMessage: 'Spanish' },
  ar: { id: 'admin.settings.language.name.ar', defaultMessage: 'Arabic' },
  ru: { id: 'admin.settings.language.name.ru', defaultMessage: 'Russian' },
  'pt-br': { id: 'admin.settings.language.name.pt-br', defaultMessage: 'Portuguese (Brazil)' },
  'zh-cn': { id: 'admin.settings.language.name.zh-cn', defaultMessage: 'Chinese (Simplified)' },
  'zh-tw': { id: 'admin.settings.language.name.zh-tw', defaultMessage: 'Chinese (Traditional)' },
  nl: { id: 'admin.settings.language.name.nl', defaultMessage: 'Dutch' },
  pl: { id: 'admin.settings.language.name.pl', defaultMessage: 'Polish' },
  th: { id: 'admin.settings.language.name.th', defaultMessage: 'Thai' },
  uk: { id: 'admin.settings.language.name.uk', defaultMessage: 'Ukrainian' },
}

/**
 * Language names for the language settings: `name` in the page's language,
 * and `option`, the same followed by the language's own name ("German
 * (Deutsch)"), so a person can find a language they cannot read.
 */
export function useLanguageNames(): {
  name: (locale: string) => string
  option: (locale: string) => string
} {
  const intl = useIntl()
  const name = (locale: string) => {
    const descriptor = LANGUAGE_NAMES[locale as SupportedLocale]
    return descriptor ? intl.formatMessage(descriptor) : locale
  }
  const option = (locale: string) => {
    const nativeName = LOCALE_NATIVE_NAMES[locale as SupportedLocale]
    const own = name(locale)
    if (!nativeName || nativeName === own) return own
    return intl.formatMessage(
      { id: 'admin.settings.language.option', defaultMessage: '{name} ({nativeName})' },
      { name: own, nativeName }
    )
  }
  return { name, option }
}
