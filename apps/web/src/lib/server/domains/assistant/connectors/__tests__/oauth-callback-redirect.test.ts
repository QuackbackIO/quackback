process.env.SECRET_KEY ||= 'test-secret-key-for-connector-oauth-abcdefgh'

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/db', () => ({ db: {}, connectors: {} }))
vi.mock('../connectors.service', () => ({
  CONNECTOR_SECRETS_PURPOSE: 'connector-secrets',
  getConnector: vi.fn(async () => null),
}))

const { finishConnectorOAuth } = await import('../oauth-provider')

const callback = (query: string) =>
  finishConnectorOAuth(new Request(`https://app.example.test/oauth/connector/callback${query}`))

describe('finishConnectorOAuth', () => {
  it('returns a provider error to the Connectors settings page', async () => {
    const response = await callback('?error=access_denied')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'https://app.example.test/admin/settings/connectors?oauth=error'
    )
  })

  it('returns a callback with no usable state to the Connectors settings page', async () => {
    const response = await callback('?code=abc&state=not-a-signed-state')
    expect(response.headers.get('location')).toBe(
      'https://app.example.test/admin/settings/connectors?oauth=error'
    )
  })
})
