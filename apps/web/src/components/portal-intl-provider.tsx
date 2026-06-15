import type { ReactNode } from 'react'
import { IntlProvider } from 'react-intl'
import { DEFAULT_LOCALE, type SupportedLocale } from '@/lib/shared/i18n'
import { useIntlSetup } from '@/lib/client/hooks/use-intl-setup'
import { onIntlError } from '@/lib/client/intl-error'

interface PortalIntlProviderProps {
  locale: SupportedLocale
  /** SSR-loaded catalog; enables localized SSR and a hydration-consistent first paint. */
  messages?: Record<string, string>
  children: ReactNode
}

export function PortalIntlProvider({
  locale,
  messages: initialMessages,
  children,
}: PortalIntlProviderProps) {
  const messages = useIntlSetup(locale, initialMessages)

  return (
    <IntlProvider
      locale={locale}
      messages={messages}
      defaultLocale={DEFAULT_LOCALE}
      onError={onIntlError}
    >
      {children}
    </IntlProvider>
  )
}
