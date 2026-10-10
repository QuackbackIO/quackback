import { useCallback, useContext } from 'react'
import { IntlContext } from 'react-intl'
import { DEFAULT_LOCALE } from '@/lib/shared/i18n'

/**
 * Numbers ("12,345") that read the same on the server and in the hydrating
 * browser.
 *
 * `n.toLocaleString()` groups digits in the runtime's default locale, which
 * differs between the server and the viewer's browser ("12,345", "12.345"),
 * and React rejects the server's markup when the two disagree. A number has
 * no time zone, so there is nothing to switch after hydration: it formats in
 * the locale of the surrounding IntlProvider, which the server resolves and
 * sends with the document, and both sides agree from the first render.
 * Outside a provider it formats in the default locale.
 */

export type NumberFormatter = (value: number, options?: Intl.NumberFormatOptions) => string

/** Formats in `locale`, for code with no IntlProvider to read. */
export function formatNumberIn(
  locale: string,
  value: number,
  options?: Intl.NumberFormatOptions
): string {
  return new Intl.NumberFormat(locale, options).format(value)
}

/** The number formatter for the app's locale; stable while that locale is. */
export function useFormatNumber(): NumberFormatter {
  const intl = useContext(IntlContext)
  return useCallback<NumberFormatter>(
    (value, options) =>
      intl ? intl.formatNumber(value, options) : formatNumberIn(DEFAULT_LOCALE, value, options),
    [intl]
  )
}
