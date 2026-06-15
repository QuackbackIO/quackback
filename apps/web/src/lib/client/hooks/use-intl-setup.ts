import { useEffect, useRef, useState } from 'react'
import { loadMessages, type SupportedLocale } from '@/lib/shared/i18n'

/**
 * Shared hook that loads the message catalog for a locale (used by
 * PortalIntlProvider and WidgetAuthProvider). It does NOT touch `<html lang>`/
 * `dir`: the root document owns those reactively (see `documentLocale`), so
 * only one place decides the document language. The widget, a separate iframe
 * document with its own runtime locale, sets its own `lang`/`dir`.
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

  return messages
}
