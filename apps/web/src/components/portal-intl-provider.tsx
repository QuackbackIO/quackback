import type { ReactNode } from 'react'
import { IntlProvider } from 'react-intl'
import { DEFAULT_LOCALE, type SupportedLocale } from '@/lib/shared/i18n'
import { useIntlSetup } from '@/lib/client/hooks/use-intl-setup'

interface PortalIntlProviderProps {
  locale: SupportedLocale
  children: ReactNode
}

export function PortalIntlProvider({ locale, children }: PortalIntlProviderProps) {
  const messages = useIntlSetup(locale)

  return (
    <IntlProvider locale={locale} messages={messages} defaultLocale={DEFAULT_LOCALE}>
      {children}
    </IntlProvider>
  )
}
