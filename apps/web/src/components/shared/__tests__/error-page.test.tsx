// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from 'vitest'
import { act, render, screen, cleanup } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import pl from '@/locales/pl.json'
import { withoutPageScopedMessages } from '@/lib/shared/i18n'
import { DocumentLocaleContext } from '../document-locale-context'

import {
  DefaultErrorPage,
  NotFoundPage,
  isAuthorizationError,
  isEntitlementError,
} from '../error-page'

describe('isAuthorizationError', () => {
  it('flags the role-gate failures thrown by requireAuth', () => {
    expect(isAuthorizationError(new Error('Access denied: Requires [admin], got member'))).toBe(
      true
    )
    expect(isAuthorizationError(new Error('Access denied: Not a team member'))).toBe(true)
  })

  it('ignores unrelated runtime errors', () => {
    expect(isAuthorizationError(new Error('Network request failed'))).toBe(false)
    expect(isAuthorizationError(new Error('undefined is not a function'))).toBe(false)
  })

  it('preserves the message of object-shaped boundary errors', () => {
    // Serialized server payloads are not `instanceof Error` but still carry
    // the classification signal in `.message`.
    expect(isAuthorizationError({ message: 'Access denied: Requires [admin], got member' })).toBe(
      true
    )
    expect(isAuthorizationError({ message: 'boom' })).toBe(false)
    expect(isAuthorizationError(null)).toBe(false)
    expect(isAuthorizationError(undefined)).toBe(false)
  })
})

describe('isEntitlementError', () => {
  it('flags a named plan refusal', () => {
    expect(
      isEntitlementError(
        new Error(
          'The audit log is an Enterprise feature. Your workspace is on Business. Upgrade to Enterprise to enable it.'
        )
      )
    ).toBe(true)
    expect(
      isEntitlementError(
        new Error('Workflows are not included in your plan. Contact us to enable it.')
      )
    ).toBe(true)
  })

  it('ignores unrelated runtime errors', () => {
    expect(isEntitlementError(new Error('boom'))).toBe(false)
    expect(isEntitlementError(new Error('Access denied: Requires [admin], got member'))).toBe(false)
  })
})

describe('DefaultErrorPage', () => {
  afterEach(() => cleanup())

  it('shows a friendly permission notice for authorization errors', () => {
    render(<DefaultErrorPage error={new Error('Access denied: Requires [admin], got member')} />)

    expect(screen.getByText(/don't have access/i)).toBeInTheDocument()
    // The raw role-gate jargon must never reach the user.
    expect(screen.queryByText(/Requires \[admin\]/)).toBeNull()
    expect(screen.queryByText(/Technical details/i)).toBeNull()
    expect(screen.queryByText(/Something went wrong/i)).toBeNull()
  })

  it('keeps the generic error treatment for everything else', () => {
    render(<DefaultErrorPage error={new Error('boom')} />)

    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument()
    expect(screen.getByText(/Technical details/i)).toBeInTheDocument()
  })

  it('shows a reference code in place of the detail when the server hid the failure', () => {
    render(
      <DefaultErrorPage
        error={{
          message: 'Something went wrong on our side. Try again in a moment. (Ref D264-C488)',
        }}
      />
    )

    expect(screen.getByText('D264-C488')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy reference' })).toBeInTheDocument()
    expect(screen.queryByText(/Technical details/i)).toBeNull()
  })

  it('never prints the raw message in a production build', () => {
    vi.stubEnv('PROD', true)
    try {
      render(<DefaultErrorPage error={new Error('connect ECONNREFUSED 10.0.4.17:5432')} />)

      expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument()
      expect(screen.queryByText(/Technical details/i)).toBeNull()
      expect(screen.queryByText(/ECONNREFUSED/)).toBeNull()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('renders the message of an object-shaped boundary error', () => {
    render(<DefaultErrorPage error={{ message: 'custom exploded' }} />)

    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument()
    expect(screen.getByText(/custom exploded/)).toBeInTheDocument()
  })

  it('does not treat a plan refusal as an unexpected crash', () => {
    render(
      <DefaultErrorPage
        error={
          new Error(
            'The audit log is an Enterprise feature. Your workspace is on Business. Upgrade to Enterprise to enable it.'
          )
        }
      />
    )

    expect(screen.queryByText(/Something went wrong/i)).toBeNull()
    expect(screen.queryByText(/Technical details/i)).toBeNull()
    expect(
      screen.getByRole('heading', { name: 'The audit log is available from the Enterprise plan' })
    ).toBeInTheDocument()
    expect(screen.getByText(/The audit log is an Enterprise feature/)).toBeInTheDocument()
  })

  it('keeps the generic plan headline when the refusal names no plan', () => {
    render(
      <DefaultErrorPage
        error={new Error('Workflows are not included in your plan. Contact us to enable it.')}
      />
    )

    expect(screen.getByRole('heading', { name: 'This is a plan feature' })).toBeInTheDocument()
  })
})

describe('error pages in the reader’s language', () => {
  afterEach(cleanup)

  it('words the not-found page in the page language', () => {
    render(
      <IntlProvider locale="pl" defaultLocale="en" messages={pl}>
        <NotFoundPage />
      </IntlProvider>
    )
    expect(screen.getByText(pl['common.errorPage.notFound.title'])).toBeTruthy()
    expect(screen.getByText(pl['common.errorPage.goHome'])).toBeTruthy()
  })

  it('words the generic error page in the page language', () => {
    render(
      <IntlProvider locale="pl" defaultLocale="en" messages={pl}>
        <DefaultErrorPage error={new Error('boom')} reset={() => {}} />
      </IntlProvider>
    )
    expect(screen.getByText(pl['common.errorPage.error.title'])).toBeTruthy()
    expect(screen.getByText(pl['common.errorPage.tryAgain'])).toBeTruthy()
    expect(screen.getByText(pl['common.errorPage.technicalDetails'])).toBeTruthy()
  })

  // Admin's IntlProvider follows the browser, but most admin pages stay English.
  it('stays English inside an English document whatever the IntlProvider says', () => {
    render(
      <DocumentLocaleContext.Provider value="en">
        <IntlProvider locale="pl" defaultLocale="en" messages={pl}>
          <NotFoundPage />
        </IntlProvider>
      </DocumentLocaleContext.Provider>
    )
    expect(screen.getByText('Page not found')).toBeTruthy()
  })

  // Pages seed their catalog without the error page strings, which load as it shows.
  it('loads its strings when the page catalog leaves them out', async () => {
    await act(async () => {
      render(
        <DocumentLocaleContext.Provider value="pl">
          <IntlProvider
            locale="pl"
            defaultLocale="en"
            messages={withoutPageScopedMessages(pl)}
            onError={() => {}}
          >
            <NotFoundPage />
          </IntlProvider>
        </DocumentLocaleContext.Provider>
      )
    })
    expect(
      await screen.findByText(pl['common.errorPage.notFound.title'], {}, { timeout: 5000 })
    ).toBeTruthy()
  })

  // The router's default not-found page can render above every IntlProvider.
  it('falls back to English when no IntlProvider is mounted', () => {
    render(<NotFoundPage />)
    expect(screen.getByText('Page not found')).toBeTruthy()
  })
})
