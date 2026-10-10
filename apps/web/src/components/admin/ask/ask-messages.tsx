import { use, useMemo, type ReactNode } from 'react'
import { IntlProvider, useIntl } from 'react-intl'
import {
  DEFAULT_LOCALE,
  isAskMessage,
  loadAskMessages,
  normalizeLocale,
  type SupportedLocale,
} from '@/lib/shared/i18n'

const loaded = new Map<SupportedLocale, Promise<Record<string, string>>>()

function askMessagesFor(locale: SupportedLocale): Promise<Record<string, string>> {
  let pending = loaded.get(locale)
  if (!pending) {
    pending = loadAskMessages(locale).catch(() => ({}))
    loaded.set(locale, pending)
  }
  return pending
}

/**
 * Supplies the Copilot and search strings, which admin pages leave out of the
 * catalog they seed. A catalog that already holds them passes straight through.
 */
export function AskMessages({ children }: { children: ReactNode }) {
  const intl = useIntl()
  if (Object.keys(intl.messages).some(isAskMessage)) return children
  return <LoadedAskMessages>{children}</LoadedAskMessages>
}

function LoadedAskMessages({ children }: { children: ReactNode }) {
  const intl = useIntl()
  const ask = use(askMessagesFor(normalizeLocale(intl.locale) ?? DEFAULT_LOCALE))
  // The app's catalogs are plain strings, never precompiled messages.
  const page = intl.messages as Record<string, string>
  const messages = useMemo(() => ({ ...page, ...ask }), [page, ask])
  return (
    <IntlProvider
      locale={intl.locale}
      defaultLocale={intl.defaultLocale}
      messages={messages}
      onError={intl.onError}
    >
      {children}
    </IntlProvider>
  )
}
