import { useEffect, useState, type ReactNode } from 'react'
import { IntlProvider } from 'react-intl'
import { loadMessages, isRtlLocale, DEFAULT_LOCALE, type SupportedLocale } from '@/lib/shared/i18n'

interface PortalIntlProviderProps {
  locale: SupportedLocale
  children: ReactNode
}

export function PortalIntlProvider({ locale, children }: PortalIntlProviderProps) {
  const [messages, setMessages] = useState<Record<string, string>>({})

  const forceRtl =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('rtl') === '1'

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
    document.documentElement.dir = forceRtl || isRtlLocale(locale) ? 'rtl' : 'ltr'
    try {
      localStorage.setItem('quackback-locale', locale)
    } catch {
      /* storage unavailable */
    }
  }, [locale, forceRtl])

  return (
    <IntlProvider locale={locale} messages={messages} defaultLocale={DEFAULT_LOCALE}>
      {children}
    </IntlProvider>
  )
}
