import { use, useMemo, type ReactNode } from 'react'
import { IntlProvider, useIntl } from 'react-intl'
import {
  DEFAULT_LOCALE,
  isSheetMessage,
  loadSheetMessages,
  normalizeLocale,
  type SupportedLocale,
} from '@/lib/shared/i18n'

const loaded = new Map<SupportedLocale, Promise<Record<string, string>>>()

function sheetMessagesFor(locale: SupportedLocale): Promise<Record<string, string>> {
  let pending = loaded.get(locale)
  if (!pending) {
    pending = loadSheetMessages(locale).catch(() => ({}))
    loaded.set(locale, pending)
  }
  return pending
}

/**
 * Supplies the setup sheets' strings, which admin pages leave out of the
 * catalog they seed. A catalog that already holds them passes straight through.
 */
export function SheetMessages({ children }: { children: ReactNode }) {
  const intl = useIntl()
  if (Object.keys(intl.messages).some(isSheetMessage)) return children
  return <LoadedSheetMessages>{children}</LoadedSheetMessages>
}

function LoadedSheetMessages({ children }: { children: ReactNode }) {
  const intl = useIntl()
  const sheets = use(sheetMessagesFor(normalizeLocale(intl.locale) ?? DEFAULT_LOCALE))
  // The app's catalogs are plain strings, never precompiled messages.
  const page = intl.messages as Record<string, string>
  const messages = useMemo(() => ({ ...page, ...sheets }), [page, sheets])
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
