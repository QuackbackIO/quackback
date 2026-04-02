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
    const prevLang = document.documentElement.lang
    const prevDir = document.documentElement.dir
    document.documentElement.lang = locale
    document.documentElement.dir = isRtlForced() || isRtlLocale(locale) ? 'rtl' : 'ltr'
    return () => {
      document.documentElement.lang = prevLang
      document.documentElement.dir = prevDir || 'ltr'
    }
  }, [locale])

  return messages
}
