import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/lib/shared/i18n'

const names = new Intl.DisplayNames(['en'], { type: 'language' })

/** A portal language as the admin reads it: "German", "Portuguese (Brazil)". */
export function languageName(locale: SupportedLocale): string {
  const [language, region] = locale.split('-')
  return names.of(region ? `${language}-${region.toUpperCase()}` : language!) ?? locale
}

/** Which language the text beside it is written in; the portal shows each visitor theirs. */
export function LanguagePicker({
  value,
  onChange,
  label = 'Language',
}: {
  value: SupportedLocale
  onChange: (locale: SupportedLocale) => void
  label?: string
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as SupportedLocale)}>
      <SelectTrigger size="sm" aria-label={label} className="w-[180px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SUPPORTED_LOCALES.map((locale) => (
          <SelectItem key={locale} value={locale}>
            {languageName(locale)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
