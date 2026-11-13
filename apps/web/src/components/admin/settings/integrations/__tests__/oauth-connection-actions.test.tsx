// @vitest-environment happy-dom
/**
 * The OAuth connect round trip lands back on the settings page with
 * `?<integration>=connected` or `?<integration>=error&reason=<code>`: a
 * success shows the confirmation, every failure reason is said in words, and
 * both strip the params so a reload does not repeat them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { IntlProvider, createIntl } from 'react-intl'

const mocks = vi.hoisted(() => ({
  search: {} as Record<string, string | undefined>,
  toastError: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => mocks.search,
  useNavigate: () => mocks.navigate,
}))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))
vi.mock('@/lib/client/mutations', () => ({
  useDeleteIntegration: () => ({ mutate: vi.fn(), isPending: false }),
}))

import { OAuthConnectionActions, oauthErrorMessage } from '../oauth-connection-actions'

function renderActions() {
  render(
    <IntlProvider locale="en" messages={{}}>
      <OAuthConnectionActions
        isConnected={false}
        searchParamKey="github"
        getConnectUrl={async () => 'https://example.test/connect'}
        displayName="GitHub"
        disconnectDescription="Disconnect?"
      />
    </IntlProvider>
  )
}

/** The search the router is left with: the strip goes through navigate. */
function strippedSearch(previous: Record<string, unknown>) {
  expect(mocks.navigate).toHaveBeenCalledTimes(1)
  const call = mocks.navigate.mock.calls[0][0]
  expect(call).toMatchObject({ to: '.', replace: true })
  return call.search(previous)
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('OAuthConnectionActions callback result', () => {
  it('confirms a connection and strips the param through the router', () => {
    mocks.search = { github: 'connected' }
    renderActions()
    expect(screen.getByText('Connected successfully!')).toBeTruthy()
    expect(strippedSearch({ github: 'connected' })).toEqual({})
  })

  it('hides the confirmation after three seconds, even once the param is gone', () => {
    vi.useFakeTimers()
    mocks.search = { github: 'connected' }
    const { rerender } = render(
      <IntlProvider locale="en" messages={{}}>
        <OAuthConnectionActions
          isConnected={false}
          searchParamKey="github"
          getConnectUrl={async () => 'https://example.test/connect'}
          displayName="GitHub"
          disconnectDescription="Disconnect?"
        />
      </IntlProvider>
    )
    // The router applies the stripped search: the result key is gone.
    mocks.search = {}
    rerender(
      <IntlProvider locale="en" messages={{}}>
        <OAuthConnectionActions
          isConnected={false}
          searchParamKey="github"
          getConnectUrl={async () => 'https://example.test/connect'}
          displayName="GitHub"
          disconnectDescription="Disconnect?"
        />
      </IntlProvider>
    )
    expect(screen.getByText('Connected successfully!')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.queryByText('Connected successfully!')).toBeNull()
  })

  it('says why a connection failed and strips both params, keeping the rest', () => {
    mocks.search = { github: 'error', reason: 'github_denied' }
    renderActions()
    expect(mocks.toastError).toHaveBeenCalledWith(
      'The connection was declined on GitHub. Connect again to allow access.',
      { id: 'oauth-result-github' }
    )
    expect(strippedSearch({ github: 'error', reason: 'github_denied', tab: 'history' })).toEqual({
      tab: 'history',
    })
  })

  it("ignores another integration's result", () => {
    mocks.search = { slack: 'error', reason: 'exchange_failed' }
    renderActions()
    expect(mocks.toastError).not.toHaveBeenCalled()
    expect(screen.queryByText('Connected successfully!')).toBeNull()
    expect(mocks.navigate).not.toHaveBeenCalled()
  })
})

describe('oauthErrorMessage', () => {
  const intl = createIntl({ locale: 'en', messages: {} })
  it.each([
    ['github_denied', 'The connection was declined on GitHub. Connect again to allow access.'],
    ['state_expired', 'The connection request expired or was not valid. Try connecting again.'],
    ['invalid_state', 'The connection request expired or was not valid. Try connecting again.'],
    ['state_mismatch', 'The connection request expired or was not valid. Try connecting again.'],
    ['invalid_request', 'The connection request expired or was not valid. Try connecting again.'],
    ['auth_required', "We couldn't confirm your sign-in. Sign in again, then connect."],
    ['session_mismatch', "We couldn't confirm your sign-in. Sign in again, then connect."],
    ['credentials_not_configured', 'Add the GitHub app credentials before connecting.'],
    [
      'already_connected_elsewhere',
      'This GitHub account is already connected to another Quackback workspace.',
    ],
    ['exchange_failed', "The connection to GitHub didn't finish. Try connecting again."],
    [undefined, "The connection to GitHub didn't finish. Try connecting again."],
  ])('%s', (reason, expected) => {
    expect(oauthErrorMessage(intl, reason, 'github', 'GitHub')).toBe(expected)
  })
})
