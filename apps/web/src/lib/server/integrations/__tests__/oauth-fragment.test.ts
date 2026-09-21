import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exchange: vi.fn(async (token: string) => ({ accessToken: token })),
  save: vi.fn(),
  session: vi.fn(),
  state: vi.fn(),
}))
vi.mock('../index', () => ({
  getIntegration: () => ({
    catalog: { settingsPath: '/admin/settings/integrations/trello' },
    platformCredentials: [],
    oauth: { callbackMode: 'fragment', stateType: 'trello_oauth', exchangeCode: mocks.exchange },
  }),
}))
vi.mock('@/lib/server/auth/oauth-state', () => ({ verifyOAuthState: mocks.state }))
vi.mock('@/lib/server/auth', () => ({ auth: { api: { getSession: mocks.session } } }))
vi.mock('@/lib/server/db', () => ({
  db: { query: { principal: { findFirst: async () => ({ id: 'principal-1' }) } } },
  principal: {},
  eq: vi.fn(),
}))
vi.mock('../save', () => ({ saveIntegration: mocks.save }))
import { handleOAuthCallback } from '../oauth-handlers'

function request(method = 'GET', cookie = 'signed-state', token = 'private-token') {
  return new Request('https://tenant.example/oauth/trello/callback?state=signed-state', {
    method,
    headers: {
      host: 'tenant.example',
      origin: 'https://tenant.example',
      cookie: `trello_oauth_state=${cookie}`,
      'content-type': 'application/json',
    },
    ...(method === 'POST' ? { body: JSON.stringify({ token }) } : {}),
  })
}
afterEach(() => vi.unstubAllEnvs())
beforeEach(() => {
  vi.stubEnv('INTEGRATION_OAUTH_GATEWAY_URL', '')
  vi.clearAllMocks()
  mocks.state.mockReturnValue({
    type: 'trello_oauth',
    returnDomain: 'tenant.example',
    principalId: 'principal-1',
    ts: Date.now(),
  })
  mocks.session.mockResolvedValue({ user: { id: 'user-1' }, session: { scope: 'dashboard' } })
})
it('serves a fragment bridge after authenticating the OAuth state and dashboard session', async () => {
  const response = await handleOAuthCallback(request(), 'trello')
  expect(response.headers.get('content-type')).toContain('text/html')
  const html = await response.text()
  expect(html).toContain('location.hash')
  expect(html).toContain('history.replaceState')
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('content-security-policy')).toContain("connect-src 'self'")
  expect(mocks.exchange).not.toHaveBeenCalled()
})
it('exchanges a posted token without putting it in a query string', async () => {
  const response = await handleOAuthCallback(request('POST'), 'trello')
  expect(response.status).toBe(302)
  expect(response.headers.get('location')).toContain('connected')
  expect(response.headers.get('location')).not.toContain('private-token')
  expect(mocks.exchange).toHaveBeenCalledWith(
    'private-token',
    'https://tenant.example/oauth/trello/callback',
    undefined,
    undefined
  )
  expect(mocks.save).toHaveBeenCalledWith('trello', {
    principalId: 'principal-1',
    accessToken: 'private-token',
  })
})
it.each(['GET', 'POST'])('rejects a mismatched cookie on %s', async (method) => {
  const response = await handleOAuthCallback(request(method, 'other-state'), 'trello')
  expect(response.headers.get('location')).toContain('state_mismatch')
  expect(mocks.exchange).not.toHaveBeenCalled()
})
it.each(['GET', 'POST'])('rejects a non-dashboard session on %s', async (method) => {
  mocks.session.mockResolvedValue({ user: { id: 'user-1' }, session: { scope: 'portal' } })
  expect((await handleOAuthCallback(request(method), 'trello')).headers.get('location')).toContain(
    'auth_required'
  )
})
it('rejects a cross-origin token POST', async () => {
  const input = request('POST')
  input.headers.set('origin', 'https://foreign.example')
  expect((await handleOAuthCallback(input, 'trello')).status).toBe(403)
  expect(mocks.exchange).not.toHaveBeenCalled()
})

it('accepts the tenant browser handoff after a shared OAuth gateway bounce', async () => {
  vi.stubEnv('INTEGRATION_OAUTH_GATEWAY_URL', 'https://app.quackback.io')
  const response = await handleOAuthCallback(request('POST'), 'trello')
  expect(response.status).toBe(302)
  expect(mocks.exchange).toHaveBeenCalledWith(
    'private-token',
    'https://app.quackback.io/oauth/trello/callback',
    undefined,
    undefined
  )
})
it('does not accept the gateway as the browser origin on a tenant token POST', async () => {
  vi.stubEnv('INTEGRATION_OAUTH_GATEWAY_URL', 'https://app.quackback.io')
  const input = request('POST')
  input.headers.set('origin', 'https://app.quackback.io')
  expect((await handleOAuthCallback(input, 'trello')).status).toBe(403)
  expect(mocks.exchange).not.toHaveBeenCalled()
})
