// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { FormattedMessage, IntlProvider } from 'react-intl'
import en from '@/locales/en.json'
import { withoutPageScopedMessages } from '@/lib/shared/i18n'
import { AreaMessages } from '../area-messages'

afterEach(cleanup)

const seeded = withoutPageScopedMessages(en)

function Placeholder() {
  return (
    <p>
      <FormattedMessage id="portal.hc.search.placeholder" defaultMessage="fallback copy" />
    </p>
  )
}

describe('AreaMessages', () => {
  it('passes through when the page catalog already holds the area', () => {
    render(
      <IntlProvider locale="en" defaultLocale="en" messages={en} onError={() => {}}>
        <AreaMessages area="helpCenter" fallback="loading">
          <Placeholder />
        </AreaMessages>
      </IntlProvider>
    )
    expect(screen.getByText('Search articles...')).toBeTruthy()
  })

  it('shows the strings a route loader read without waiting', () => {
    render(
      <IntlProvider locale="pl" defaultLocale="en" messages={seeded} onError={() => {}}>
        <AreaMessages
          area="helpCenter"
          messages={{ 'portal.hc.search.placeholder': 'Szukaj artykułów...' }}
          fallback="loading"
        >
          <Placeholder />
          <p>
            <FormattedMessage id="common.cancel" />
          </p>
        </AreaMessages>
      </IntlProvider>
    )
    expect(screen.getByText('Szukaj artykułów...')).toBeTruthy()
    // The page's own strings stay available inside the area.
    expect(screen.getByText(en['common.cancel'])).toBeTruthy()
  })

  it("loads the area's strings in the page locale, showing the fallback meanwhile", async () => {
    let fallbackShown = false
    function Loading() {
      fallbackShown = true
      return <p>loading</p>
    }
    // React retries a render that suspended only once it ran in an awaited `act`.
    await act(async () => {
      render(
        <IntlProvider locale="pl" defaultLocale="en" messages={seeded} onError={() => {}}>
          <AreaMessages area="helpCenter" fallback={<Loading />}>
            <Placeholder />
          </AreaMessages>
        </IntlProvider>
      )
    })
    expect(await screen.findByText('Szukaj artykułów...')).toBeTruthy()
    expect(fallbackShown).toBe(true)
    expect(screen.queryByText('loading')).toBeNull()
  })
})
