// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { SsoTestSignInProvider, useSsoTestSignIn } from '../use-sso-test-sign-in'
import { SSO_TEST_POSTMESSAGE_SOURCE } from '@/lib/shared/sso-test-keys'

vi.mock('@tanstack/react-start', () => ({
  useServerFn: () =>
    vi.fn(async () => ({ testId: 'ssotest_x', authorizeUrl: 'https://idp.example/auth' })),
}))

vi.mock('@/lib/server/functions/sso-test', () => ({
  startSsoTestFn: vi.fn(),
  getSsoTestResultFn: vi.fn(),
}))

vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({
  openAuthPopup: vi.fn(() => ({ close: vi.fn() })),
  usePopupTracker: () => ({ trackPopup: vi.fn(), clearPopup: vi.fn() }),
}))

function Probe() {
  const { lastSuccess, lastCapture, open } = useSsoTestSignIn()
  return (
    <div>
      <button type="button" onClick={() => open({ registrationId: 'oidc_x' })}>
        open-test
      </button>
      <div data-testid="success-at">{lastSuccess?.capturedAt ?? ''}</div>
      <div data-testid="capture-at">{lastCapture?.capturedAt ?? ''}</div>
      <div data-testid="success-id">{lastSuccess?.identity?.id ?? ''}</div>
      <div data-testid="capture-id">{lastCapture?.identity?.id ?? 'none'}</div>
    </div>
  )
}

const capture = {
  version: 2 as const,
  registrationId: 'oidc_x',
  capturedAt: '2026-09-07T12:00:00.000Z',
  detailsChangedAtAtStart: null,
  outcome: 'success' as const,
  identity: { id: 'person-1', email: 'jane@example.test', sources: { id: 'idToken' } },
  claims: { sub: 'person-1' },
  replay: { sources: [{ source: 'idToken' as const, claims: { sub: 'person-1' } }] },
}

describe('SSO test capture context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('carries server capture metadata instead of rebuilding it with browser time', async () => {
    render(
      <SsoTestSignInProvider>
        <Probe />
      </SsoTestSignInProvider>
    )
    await act(async () => {
      screen.getByText('open-test').click()
    })
    await act(async () => {
      screen.getByRole('button', { name: /start test sign-in/i }).click()
    })

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          data: {
            source: SSO_TEST_POSTMESSAGE_SOURCE,
            result: {
              ok: true,
              steps: [],
              claims: { iss: 'https://idp', sub: 'person-1', aud: 'cid' },
              tokenInfo: { idTokenAlg: 'RS256', hasAccessToken: true, hasRefreshToken: false },
              capture,
            },
            identityMatched: true,
          },
        })
      )
    })

    expect(screen.getByTestId('success-at').textContent).toBe('2026-09-07T12:00:00.000Z')
    expect(screen.getByTestId('capture-at').textContent).toBe('2026-09-07T12:00:00.000Z')
    expect(screen.getByTestId('success-id').textContent).toBe('person-1')
  })

  it('keeps mapping-failure captures on lastCapture without treating them as lastSuccess', async () => {
    render(
      <SsoTestSignInProvider>
        <Probe />
      </SsoTestSignInProvider>
    )
    await act(async () => {
      screen.getByText('open-test').click()
    })
    await act(async () => {
      screen.getByRole('button', { name: /start test sign-in/i }).click()
    })

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          data: {
            source: SSO_TEST_POSTMESSAGE_SOURCE,
            result: {
              ok: false,
              stage: 'claim-check',
              hint: 'No email address was released',
              steps: [],
              capture: { ...capture, outcome: 'mapping_failed', identity: undefined },
            },
          },
        })
      )
    })

    expect(screen.getByTestId('success-id').textContent).toBe('')
    expect(screen.getByTestId('capture-at').textContent).toBe('2026-09-07T12:00:00.000Z')
    expect(screen.getByTestId('capture-id').textContent).toBe('none')
  })
})
