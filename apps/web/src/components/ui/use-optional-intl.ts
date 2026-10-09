import { useContext } from 'react'
import { createIntl, IntlContext, type IntlShape } from 'react-intl'

// Shared primitives also render outside any IntlProvider (standalone pages,
// isolated tests); there they word their copy in the default message.
const fallbackIntl = createIntl({ locale: 'en', messages: {}, onError: () => {} })

/** The surrounding intl, or one that formats default messages when there is none. */
export function useOptionalIntl(): IntlShape {
  return useContext(IntlContext) ?? fallbackIntl
}
