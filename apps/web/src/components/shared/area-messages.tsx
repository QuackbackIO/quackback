/**
 * One area's strings, which pages leave out of the catalog they seed (see
 * `AREA_MESSAGE_PREFIXES`). The routes that show an area read its strings in
 * their loader and pass them here, beside the page's own.
 */
import { useMemo, type ReactNode } from 'react'
import { IntlProvider, useIntl } from 'react-intl'

export function AreaMessages({
  messages,
  children,
}: {
  messages: Record<string, string>
  children: ReactNode
}) {
  const intl = useIntl()
  // The app's catalogs are plain strings, never precompiled messages.
  const pageMessages = intl.messages as Record<string, string>
  const merged = useMemo(() => ({ ...pageMessages, ...messages }), [pageMessages, messages])
  return (
    <IntlProvider
      locale={intl.locale}
      defaultLocale={intl.defaultLocale}
      messages={merged}
      onError={intl.onError}
    >
      {children}
    </IntlProvider>
  )
}
