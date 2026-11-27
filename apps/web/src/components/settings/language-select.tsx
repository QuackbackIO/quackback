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
import { setMyLanguageFn, type MyLanguage } from '@/lib/server/functions/person-language'

const AUTOMATIC = 'auto'

/**
 * The picker's languages, in the order a person picks one (Latin script
 * first, then the others), each in its own name and in English. Kept here
 * rather than read from the shared names, so the Preferences page does not
 * pull that module into a chunk of its own on the pages that also use it.
 */
const LANGUAGES: ReadonlyArray<{ locale: SupportedLocale; own: string; english: string }> = [
  { locale: 'en', own: 'English', english: 'English' },
  { locale: 'de', own: 'Deutsch', english: 'German' },
  { locale: 'es', own: 'Español', english: 'Spanish' },
  { locale: 'fr', own: 'Français', english: 'French' },
  { locale: 'nl', own: 'Nederlands', english: 'Dutch' },
  { locale: 'pl', own: 'Polski', english: 'Polish' },
  { locale: 'pt-br', own: 'Português (Brasil)', english: 'Portuguese' },
  { locale: 'ru', own: 'Русский', english: 'Russian' },
  { locale: 'uk', own: 'Українська', english: 'Ukrainian' },
  { locale: 'ar', own: 'العربية', english: 'Arabic' },
  { locale: 'th', own: 'ภาษาไทย', english: 'Thai' },
  { locale: 'zh-cn', own: '简体中文', english: 'Chinese (Simplified)' },
  { locale: 'zh-tw', own: '繁體中文', english: 'Chinese (Traditional)' },
]

const ownName = (locale: string) => LANGUAGES.find((l) => l.locale === locale)?.own ?? locale

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
  const automaticName = ownName(initial.automatic)

  const automaticLabel = intl.formatMessage(
    {
      id: 'portal.settings.preferences.appearance.languageAutomaticNamed',
      defaultMessage: 'Automatic ({language})',
    },
    { language: automaticName }
  )
  const labelOf = (value: string) => (value === AUTOMATIC ? automaticLabel : ownName(value))

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
      <DropdownMenuContent className="min-w-(--anchor-width) max-w-(--available-width)">
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => void choose(String(next))}>
          <DropdownMenuRadioItem value={AUTOMATIC}>
            <span className="flex w-full items-center justify-between gap-4">
              <span>
                {intl.formatMessage({
                  id: 'portal.settings.preferences.appearance.languageAutomatic',
                  defaultMessage: 'Automatic',
                })}
              </span>
              <span className="whitespace-nowrap text-xs text-muted-foreground">
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
          {LANGUAGES.map(({ locale, own, english }) => (
            <DropdownMenuRadioItem key={locale} value={locale}>
              <span className="flex w-full items-center justify-between gap-4">
                <span lang={locale}>{own}</span>
                {locale !== 'en' && (
                  <span lang="en" className="text-xs text-muted-foreground">
                    {english}
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
