// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { FormattedMessage, IntlProvider, useIntl } from 'react-intl'
import en from '@/locales/en.json'
import { withoutPageScopedMessages } from '@/lib/shared/i18n'
import { AreaMessages } from '../area-messages'

afterEach(cleanup)

function Locale() {
  return <p>{useIntl().locale}</p>
}

describe('AreaMessages', () => {
  it("shows the strings a route loader read beside the page's own, in the page locale", () => {
    render(
      <IntlProvider
        locale="pl"
        defaultLocale="en"
        messages={withoutPageScopedMessages(en)}
        onError={() => {}}
      >
        <AreaMessages messages={{ 'portal.hc.search.placeholder': 'Szukaj artykułów...' }}>
          <p>
            <FormattedMessage id="portal.hc.search.placeholder" defaultMessage="fallback copy" />
          </p>
          <p>
            <FormattedMessage id="common.cancel" />
          </p>
          <Locale />
        </AreaMessages>
      </IntlProvider>
    )
    expect(screen.getByText('Szukaj artykułów...')).toBeTruthy()
    expect(screen.getByText(en['common.cancel'])).toBeTruthy()
    expect(screen.getByText('pl')).toBeTruthy()
  })
})
