import { describe, expect, it } from 'vitest'
import { mergeIntegrationConfig } from '../save'

describe('mergeIntegrationConfig', () => {
  it('keeps channelId and webhook ids when GitHub OAuth reconnects', () => {
    expect(
      mergeIntegrationConfig(
        {
          channelId: 'acme/api',
          webhookSecret: 'hook-secret',
          externalWebhookId: '12',
          username: 'old-login',
        },
        { username: 'new-login', workspaceName: 'new-login' }
      )
    ).toEqual({
      channelId: 'acme/api',
      webhookSecret: 'hook-secret',
      externalWebhookId: '12',
      username: 'new-login',
      workspaceName: 'new-login',
    })
  })

  it('writes tokenExpiresAt when OAuth returns an expiry', () => {
    const expires = new Date('2026-09-01T00:00:00.000Z')
    expect(mergeIntegrationConfig({ channelId: 'acme/api' }, { username: 'ops' }, expires)).toEqual(
      {
        channelId: 'acme/api',
        username: 'ops',
        tokenExpiresAt: expires.toISOString(),
      }
    )
  })

  it('starts from the OAuth blob when there is no stored config', () => {
    expect(mergeIntegrationConfig(null, { username: 'ops' })).toEqual({ username: 'ops' })
  })
})
