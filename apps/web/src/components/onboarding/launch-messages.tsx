import { useMemo, type ReactNode } from 'react'
import { IntlProvider, useIntl } from 'react-intl'

/**
 * Adds Home's and the Launch plan page's strings, which their route loaders
 * load and the admin seed leaves out, to the page's catalog.
 */
export function LaunchMessages({
  messages,
  children,
}: {
  messages: Record<string, string>
  children: ReactNode
}) {
  const intl = useIntl()
  // The app's catalogs are plain strings, never precompiled messages.
  const page = intl.messages as Record<string, string>
  const merged = useMemo(() => ({ ...page, ...messages }), [page, messages])
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
