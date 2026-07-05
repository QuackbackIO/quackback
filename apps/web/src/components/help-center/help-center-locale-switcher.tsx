import { useNavigate } from '@tanstack/react-router'
import { GlobeAltIcon } from '@heroicons/react/24/outline'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { localizedHcPath } from '@/lib/shared/help-center-url'

/** Sticky manual override so browser-detect doesn't fight an explicit choice. */
export const HC_LOCALE_COOKIE = 'hc_locale'

const LOCALE_LABELS: Record<string, string> = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  ar: 'العربية',
  ru: 'Русский',
  'pt-br': 'Português (Brasil)',
  'zh-cn': '简体中文',
  'zh-tw': '繁體中文',
}

interface HelpCenterLocaleSwitcherProps {
  currentLocale: string
  defaultLocale: string
  additionalLocales: string[]
  /** The unprefixed /hc path of the page currently being viewed. */
  canonicalPath: string
}

/**
 * Manual locale switcher (domains/languages §2), rendered on every /hc page
 * so it's reachable regardless of default vs. locale-prefixed subtree.
 * Hidden entirely when no additional locale is enabled.
 */
export function HelpCenterLocaleSwitcher({
  currentLocale,
  defaultLocale,
  additionalLocales,
  canonicalPath,
}: HelpCenterLocaleSwitcherProps) {
  const navigate = useNavigate()
  if (additionalLocales.length === 0) return null

  const locales = [defaultLocale, ...additionalLocales]

  function handleChange(next: string) {
    if (typeof document !== 'undefined') {
      // 1 year, readable by the server for the browser-detect redirect on /hc.
      document.cookie = `${HC_LOCALE_COOKIE}=${next}; path=/hc; max-age=31536000; samesite=lax`
    }
    const target = localizedHcPath(next, canonicalPath)
    void navigate({ to: target as string as '/', replace: true })
  }

  return (
    <Select value={currentLocale} onValueChange={handleChange}>
      <SelectTrigger size="sm" className="h-8 gap-1.5 rounded-full text-xs" aria-label="Language">
        <GlobeAltIcon className="h-3.5 w-3.5" />
        <SelectValue>{LOCALE_LABELS[currentLocale] ?? currentLocale}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        {locales.map((locale) => (
          <SelectItem key={locale} value={locale}>
            {LOCALE_LABELS[locale] ?? locale}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
