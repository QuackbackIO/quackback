// @vitest-environment happy-dom
/**
 * The OAuth connect round trip lands back on the settings page with
 * `?<integration>=connected` or `?<integration>=error&reason=<code>`: a
 * success shows the confirmation, every failure reason is said in words, and
 * both strip the params so a reload does not repeat them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { IntlProvider, createIntl } from 'react-intl'

const mocks = vi.hoisted(() => ({
  search: {} as Record<string, string | undefined>,
  toastError: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({ useSearch: () => mocks.search }))
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

beforeEach(() => {
  vi.clearAllMocks()
  window.history.replaceState({}, '', '/admin/settings/integrations/github')
})
afterEach(cleanup)

describe('OAuthConnectionActions callback result', () => {
  it('confirms a connection and strips the param', () => {
    mocks.search = { github: 'connected' }
    window.history.replaceState({}, '', '/admin/settings/integrations/github?github=connected')
    renderActions()
    expect(screen.getByText('Connected successfully!')).toBeTruthy()
    expect(window.location.search).toBe('')
  })

  it('says why a connection failed and strips both params', () => {
    mocks.search = { github: 'error', reason: 'github_denied' }
    window.history.replaceState(
      {},
      '',
      '/admin/settings/integrations/github?github=error&reason=github_denied&tab=history'
    )
    renderActions()
    expect(mocks.toastError).toHaveBeenCalledWith(
      'The connection was declined on GitHub. Connect again to allow access.',
      { id: 'oauth-result-github' }
    )
    expect(window.location.search).toBe('?tab=history')
  })

  it("ignores another integration's result", () => {
    mocks.search = { slack: 'error', reason: 'exchange_failed' }
    renderActions()
    expect(mocks.toastError).not.toHaveBeenCalled()
    expect(screen.queryByText('Connected successfully!')).toBeNull()
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
    ['auth_required', 'Your session changed while connecting. Sign in again, then connect.'],
    ['session_mismatch', 'Your session changed while connecting. Sign in again, then connect.'],
    ['credentials_not_configured', 'Add the GitHub app credentials before connecting.'],
    [
      'already_connected_elsewhere',
      'This GitHub account is already connected to another Quackback workspace.',
    ],
    ['exchange_failed', "GitHub didn't finish the connection. Try connecting again."],
    [undefined, "GitHub didn't finish the connection. Try connecting again."],
  ])('%s', (reason, expected) => {
    expect(oauthErrorMessage(intl, reason, 'github', 'GitHub')).toBe(expected)
  })
})
