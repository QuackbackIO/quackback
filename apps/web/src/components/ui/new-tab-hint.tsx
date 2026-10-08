import { useContext } from 'react'
import { IntlContext } from 'react-intl'

const MESSAGE = { id: 'common.opensInNewTab', defaultMessage: '(opens in a new tab)' }

/**
 * Visually hidden text for a link that opens in a new tab, so screen readers
 * say so. Put it inside the link, after its label. It reads the intl context
 * directly so a link rendered outside a provider still gets the English text.
 */
export function NewTabHint() {
  const intl = useContext(IntlContext)
  return (
    <span className="sr-only"> {intl ? intl.formatMessage(MESSAGE) : MESSAGE.defaultMessage}</span>
  )
}
