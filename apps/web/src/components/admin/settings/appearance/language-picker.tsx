import type { SupportedLocale } from '@/lib/shared/i18n'

const names = new Intl.DisplayNames(['en'], { type: 'language' })

/** A portal language as the admin reads it: "German", "Portuguese (Brazil)". */
export function languageName(locale: SupportedLocale): string {
  const [language, region] = locale.split('-')
  return names.of(region ? `${language}-${region.toUpperCase()}` : language!) ?? locale
}
