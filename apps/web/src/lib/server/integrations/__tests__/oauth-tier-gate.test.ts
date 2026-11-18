import { beforeEach, expect, it, vi } from 'vitest'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'

const mocks = vi.hoisted(() => ({
  buildAuthUrl: vi.fn(() => 'https://provider.example/authorize'),
  exchange: vi.fn(async (code: string) => ({ accessToken: code })),
  save: vi.fn(),
  session: vi.fn(),
  state: vi.fn(),
  limits: vi.fn(),
}))
vi.mock('../index', () => ({
  getIntegration: () => ({
    catalog: { settingsPath: '/admin/settings/integrations/acme' },
    platformCredentials: [],
    oauth: {
      stateType: 'acme_oauth',
      buildAuthUrl: mocks.buildAuthUrl,
      exchangeCode: mocks.exchange,
    },
  }),
}))
vi.mock('@/lib/server/auth/oauth-state', () => ({ verifyOAuthState: mocks.state }))
vi.mock('@/lib/server/auth', () => ({ auth: { api: { getSession: mocks.session } } }))
vi.mock('@/lib/server/db', () => ({
  db: { query: { principal: { findFirst: async () => ({ id: 'principal-1' }) } } },
  principal: {},
  eq: vi.fn(),
}))
vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: mocks.limits,
}))
vi.mock('../save', () => ({ saveIntegration: mocks.save }))
import { handleOAuthCallback, handleOAuthConnect } from '../oauth-handlers'

const CHANNEL_PATH = '/admin/settings/channels/github'

function connectRequest() {
  return new Request('https://tenant.example/oauth/acme/connect?state=signed-state', {
    headers: { host: 'tenant.example' },
  })
}
function callbackRequest() {
  return new Request('https://tenant.example/oauth/acme/callback?state=signed-state&code=abc', {
    headers: {
      host: 'tenant.example',
      cookie: 'acme_oauth_state=signed-state',
      'content-type': 'application/json',
    },
  })
}
function setIntegrationsFeature(enabled: boolean) {
  mocks.limits.mockResolvedValue({
    ...OSS_TIER_LIMITS,
    features: { ...OSS_TIER_LIMITS.features, integrations: enabled },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  setIntegrationsFeature(true)
  mocks.state.mockReturnValue({
    type: 'acme_oauth',
    returnDomain: 'tenant.example',
    principalId: 'principal-1',
    ts: Date.now(),
  })
  mocks.session.mockResolvedValue({ user: { id: 'user-1' }, session: { scope: 'dashboard' } })
})

it('starts a connection when the plan includes integrations', async () => {
  const response = await handleOAuthConnect(connectRequest(), 'acme')
  expect(response.status).toBe(302)
  expect(mocks.buildAuthUrl).toHaveBeenCalled()
})

it('refuses to start a connection when the plan lacks integrations', async () => {
  setIntegrationsFeature(false)
  const response = await handleOAuthConnect(connectRequest(), 'acme')
  expect(response.status).toBe(402)
  expect(await response.json()).toMatchObject({
    error: 'tier_limit_exceeded',
    limit: 'features.integrations',
  })
  expect(mocks.buildAuthUrl).not.toHaveBeenCalled()
})

it('completes the callback when the plan includes integrations', async () => {
  const response = await handleOAuthCallback(callbackRequest(), 'acme')
  expect(response.headers.get('location')).toContain('acme=connected')
  expect(mocks.save).toHaveBeenCalled()
})

it('refuses the callback when the plan lacks integrations, saving nothing', async () => {
  setIntegrationsFeature(false)
  const response = await handleOAuthCallback(callbackRequest(), 'acme')
  expect(response.headers.get('location')).toContain('reason=plan_required')
  expect(mocks.exchange).not.toHaveBeenCalled()
  expect(mocks.save).not.toHaveBeenCalled()
})

it('leaves the support channel connect flow alone on a plan without integrations', async () => {
  setIntegrationsFeature(false)
  mocks.state.mockReturnValue({
    type: 'acme_oauth',
    returnDomain: 'tenant.example',
    principalId: 'principal-1',
    ts: Date.now(),
    returnPath: CHANNEL_PATH,
  })
  const connect = await handleOAuthConnect(connectRequest(), 'acme')
  expect(connect.status).toBe(302)
  const callback = await handleOAuthCallback(callbackRequest(), 'acme')
  expect(callback.headers.get('location')).toContain('connected')
  expect(mocks.save).toHaveBeenCalled()
})
