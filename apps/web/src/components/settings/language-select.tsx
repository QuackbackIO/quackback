import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { createIntl, useIntl, type MessageDescriptor } from 'react-intl'
import { toast } from 'sonner'
import { ChevronDownIcon } from '@heroicons/react/24/solid'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { loadAreaMessages, type SupportedLocale } from '@/lib/shared/i18n'
import { LOCALE_NATIVE_NAMES } from '@/lib/shared/locale-names'
import { setMyLanguageFn, type MyLanguage } from '@/lib/server/functions/person-language'

const AUTOMATIC = 'auto'

/** Each language the product has, named in English, shown beside its own name. */
const LOCALE_ENGLISH_NAMES: Record<SupportedLocale, string> = {
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
const LOCALE_PICKER_ORDER: readonly SupportedLocale[] = [
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

const SAVED: MessageDescriptor = {
  id: 'portal.settings.preferences.appearance.languageSaved',
  defaultMessage: 'Language saved',
}

/** A message in another language than the page's, for the toast after a change. */
async function formatIn(locale: SupportedLocale, descriptor: MessageDescriptor): Promise<string> {
  const messages = await loadAreaMessages(locale, 'settings')
  return createIntl({ locale, messages, onError: () => {} }).formatMessage(descriptor)
}

/**
 * The Language row under Theme: "Automatic" (the browser's language, named
 * in brackets), then each language in its own name with its English name in
 * grey. Saves on select, like Theme, and reloads the page's data so the page
 * changes language at once.
 */
export function LanguageSelect({ initial }: { initial: MyLanguage }) {
  const intl = useIntl()
  const router = useRouter()
  const [chosen, setChosen] = useState<SupportedLocale | null>(initial.chosen)
  const automaticName = LOCALE_NATIVE_NAMES[initial.automatic]

  const automaticLabel = intl.formatMessage(
    {
      id: 'portal.settings.preferences.appearance.languageAutomaticNamed',
      defaultMessage: 'Automatic ({language})',
    },
    { language: automaticName }
  )
  const labelOf = (value: string) =>
    value === AUTOMATIC ? automaticLabel : LOCALE_NATIVE_NAMES[value as SupportedLocale]

  async function choose(value: string) {
    const next = value === AUTOMATIC ? null : (value as SupportedLocale)
    if (next === chosen) return
    const previous = chosen
    setChosen(next)
    try {
      await setMyLanguageFn({ data: { language: next } })
      const saved = await formatIn(next ?? initial.automatic, SAVED)
      await router.invalidate()
      toast.success(saved)
    } catch {
      setChosen(previous)
      toast.error(
        intl.formatMessage({
          id: 'portal.settings.preferences.appearance.languageSaveFailed',
          defaultMessage: 'Could not save your language',
        })
      )
    }
  }

  const value = chosen ?? AUTOMATIC
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-9 w-full items-center justify-between gap-2 rounded-field border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring sm:w-72"
        aria-label={intl.formatMessage({
          id: 'portal.settings.preferences.appearance.languageLabel',
          defaultMessage: 'Language',
        })}
      >
        <span className="truncate">{labelOf(value)}</span>
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-(--anchor-width) min-w-64">
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => void choose(String(next))}>
          <DropdownMenuRadioItem value={AUTOMATIC}>
            <span className="flex w-full items-center justify-between gap-4">
              <span>
                {intl.formatMessage({
                  id: 'portal.settings.preferences.appearance.languageAutomatic',
                  defaultMessage: 'Automatic',
                })}
              </span>
              <span className="text-xs text-muted-foreground">
                {initial.automaticFromBrowser
                  ? intl.formatMessage(
                      {
                        id: 'portal.settings.preferences.appearance.languageFromBrowser',
                        defaultMessage: '{language}, from your browser',
                      },
                      { language: automaticName }
                    )
                  : automaticName}
              </span>
            </span>
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {LOCALE_PICKER_ORDER.map((locale) => (
            <DropdownMenuRadioItem key={locale} value={locale}>
              <span className="flex w-full items-center justify-between gap-4">
                <span lang={locale}>{LOCALE_NATIVE_NAMES[locale]}</span>
                {locale !== 'en' && (
                  <span lang="en" className="text-xs text-muted-foreground">
                    {LOCALE_ENGLISH_NAMES[locale]}
                  </span>
                )}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
