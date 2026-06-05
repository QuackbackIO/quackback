import { ReactIntlErrorCode, type IntlConfig } from 'react-intl'

/**
 * Shared react-intl error handler for the portal and widget providers.
 *
 * Locale catalogs are code-split and loaded asynchronously (see
 * `useIntlSetup`), so during SSR and the first client render the message
 * map is empty and react-intl reports MISSING_TRANSLATION for every key
 * before falling back to the inline English `defaultMessage`. That
 * fallback is by design — every `<FormattedMessage>` carries a
 * `defaultMessage`, so a missing catalog entry degrades to readable English
 * rather than a broken key — so we swallow MISSING_TRANSLATION to keep it
 * out of the server logs and the browser console while still surfacing
 * genuine intl errors (bad ICU syntax, missing locale data, etc.).
 */
export const onIntlError: NonNullable<IntlConfig['onError']> = (error) => {
  if (error.code === ReactIntlErrorCode.MISSING_TRANSLATION) return
  console.error(error)
}
