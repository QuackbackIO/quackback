import { useEffect, useRef, useState } from 'react'
import { loadMessages, isRtlLocale, isRtlForced, type SupportedLocale } from '@/lib/shared/i18n'

/**
 * Shared hook that loads locale messages and sets `lang`/`dir` on <html>.
 * Used by both PortalIntlProvider and WidgetAuthProvider.
 *
 * Pass `initialMessages` (loaded server-side and serialized into the route's
 * loader data) so SSR renders translated and the client hydrates from the same
 * catalog — without it the page renders English until the client fetch lands.
 */
export function useIntlSetup(
  locale: SupportedLocale,
  initialMessages?: Record<string, string>
): Record<string, string> {
  const hasInitial = !!initialMessages && Object.keys(initialMessages).length > 0
  const [messages, setMessages] = useState<Record<string, string>>(initialMessages ?? {})
  // The locale whose catalog is already in `messages`. When SSR seeds it we
  // skip the initial fetch (and the redundant network chunk it would pull); a
  // later locale change still loads the new catalog.
  const loadedLocale = useRef<SupportedLocale | null>(hasInitial ? locale : null)

  useEffect(() => {
    if (loadedLocale.current === locale) return
    let cancelled = false
    loadMessages(locale).then((msgs) => {
      if (!cancelled) {
        setMessages(msgs)
        loadedLocale.current = locale
      }
    })
    return () => {
      cancelled = true
    }
  }, [locale])

  // Keep `<html lang/dir>` in step with runtime locale changes (e.g. the widget's
  // `quackback:locale` postMessage). The root document already sets the correct
  // value for the initial render/navigation, so this only nudges it forward and
  // must NOT restore a captured value on cleanup: doing so re-applies a stale
  // locale when unmounting (e.g. leaving a localized page for the English admin
  // app), fighting the root document's reactive value.
  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = isRtlForced() || isRtlLocale(locale) ? 'rtl' : 'ltr'
  }, [locale])

  return messages
}
