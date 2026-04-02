import { useEffect, useState } from 'react'
import { loadMessages, isRtlLocale, isRtlForced, type SupportedLocale } from '@/lib/shared/i18n'

/**
 * Shared hook that loads locale messages and sets `lang`/`dir` on <html>.
 * Used by both PortalIntlProvider and WidgetAuthProvider.
 */
export function useIntlSetup(locale: SupportedLocale): Record<string, string> {
  const [messages, setMessages] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    loadMessages(locale).then((msgs) => {
      if (!cancelled) setMessages(msgs)
    })
    return () => {
      cancelled = true
    }
  }, [locale])

  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = isRtlForced() || isRtlLocale(locale) ? 'rtl' : 'ltr'
  }, [locale])

  return messages
}
