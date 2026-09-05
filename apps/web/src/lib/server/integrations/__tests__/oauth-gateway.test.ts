import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCallbackUri } from '../oauth'

afterEach(() => vi.unstubAllEnvs())
describe('integration OAuth gateway', () => {
  const request = new Request('https://tenant.example/oauth/slack/connect', {
    headers: { host: 'tenant.example' },
  })
  it('keeps the tenant callback when unset', () => {
    vi.stubEnv('INTEGRATION_OAUTH_GATEWAY_URL', '')
    expect(buildCallbackUri('slack', request)).toBe('https://tenant.example/oauth/slack/callback')
  })
  it.each(['slack', 'github', 'linear', 'trello'])(
    'uses the same gateway callback for %s authorize and exchange',
    (integration) => {
      vi.stubEnv('INTEGRATION_OAUTH_GATEWAY_URL', 'https://app.quackback.io/')
      expect(buildCallbackUri(integration, request)).toBe(
        `https://app.quackback.io/oauth/${integration}/callback`
      )
    }
  )
  it.each([
    'http://gateway.example',
    'https://gateway.example/path',
    'https://u:p@gateway.example',
    'https://gateway.example?x=1',
    'https://gateway.example#x',
  ])('rejects invalid gateway %s', (gateway) => {
    vi.stubEnv('INTEGRATION_OAUTH_GATEWAY_URL', gateway)
    expect(() => buildCallbackUri('slack', request)).toThrow('HTTPS origin')
  })
})
