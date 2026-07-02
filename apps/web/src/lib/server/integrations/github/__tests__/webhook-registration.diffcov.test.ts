import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  update: vi.fn(),
  decryptSecrets: vi.fn(),
  generateWebhookSecret: vi.fn(),
  buildWebhookCallbackUrl: vi.fn(),
  eq: vi.fn((a: unknown, b: unknown) => ({ a, b })),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      integrations: {
        findFirst: mocks.findFirst,
      },
    },
    update: mocks.update,
  },
  integrations: { id: 'integrations.id' },
  eq: mocks.eq,
}))

vi.mock('@/lib/server/integrations/encryption', () => ({
  decryptSecrets: mocks.decryptSecrets,
}))

vi.mock('@/lib/server/integrations/webhook-registration', () => ({
  generateWebhookSecret: mocks.generateWebhookSecret,
  buildWebhookCallbackUrl: mocks.buildWebhookCallbackUrl,
}))

import {
  deleteGitHubWebhook,
  deleteConfiguredGitHubWebhook,
  ensureGitHubWebhookForIntegration,
  GITHUB_WEBHOOK_EVENTS_VERSION,
} from '../webhook-registration'
import type { IntegrationId } from '@quackback/ids'

const originalFetch = globalThis.fetch

function mockFetch(status: number, body: unknown = {}) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.fetch = originalFetch
  // db.update(...).set(...).where(...) chain
  mocks.updateWhere.mockResolvedValue(undefined)
  mocks.updateSet.mockReturnValue({ where: mocks.updateWhere })
  mocks.update.mockReturnValue({ set: mocks.updateSet })
  mocks.generateWebhookSecret.mockReturnValue('generated-secret')
  mocks.buildWebhookCallbackUrl.mockReturnValue(
    'https://app.example.com/api/integrations/github/webhook'
  )
})

describe('deleteGitHubWebhook', () => {
  it('sends a DELETE request to the GitHub hooks endpoint', async () => {
    const fetchMock = mockFetch(204)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await deleteGitHubWebhook('gh_token', 'org/repo', '999')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/org/repo/hooks/999',
      expect.objectContaining({ method: 'DELETE' })
    )
  })
})

describe('deleteConfiguredGitHubWebhook', () => {
  it('returns early when secrets are missing', async () => {
    await deleteConfiguredGitHubWebhook({
      secrets: null,
      config: { channelId: 'org/repo', externalWebhookId: '1' },
    })
    expect(mocks.decryptSecrets).not.toHaveBeenCalled()
  })

  it('returns early when ownerRepo is missing', async () => {
    await deleteConfiguredGitHubWebhook({
      secrets: 'cipher',
      config: { externalWebhookId: '1' },
    })
    expect(mocks.decryptSecrets).not.toHaveBeenCalled()
  })

  it('returns early when webhookId is missing', async () => {
    await deleteConfiguredGitHubWebhook({
      secrets: 'cipher',
      config: { channelId: 'org/repo' },
    })
    expect(mocks.decryptSecrets).not.toHaveBeenCalled()
  })

  it('returns early when the decrypted access token is missing', async () => {
    mocks.decryptSecrets.mockReturnValue({})
    const fetchMock = mockFetch(204)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await deleteConfiguredGitHubWebhook({
      secrets: 'cipher',
      config: { channelId: 'org/repo', externalWebhookId: '7' },
    })

    expect(mocks.decryptSecrets).toHaveBeenCalledWith('cipher')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('deletes the configured webhook when everything is present', async () => {
    mocks.decryptSecrets.mockReturnValue({ accessToken: 'gh_token' })
    const fetchMock = mockFetch(204)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await deleteConfiguredGitHubWebhook({
      secrets: 'cipher',
      config: { channelId: 'org/repo', externalWebhookId: '7' },
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/org/repo/hooks/7',
      expect.objectContaining({ method: 'DELETE' })
    )
  })
})

describe('ensureGitHubWebhookForIntegration', () => {
  const integrationId = 'integration_1' as IntegrationId

  it('returns early when the integration is missing', async () => {
    mocks.findFirst.mockResolvedValue(undefined)
    await ensureGitHubWebhookForIntegration({ integrationId })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('returns early when the integration is not active', async () => {
    mocks.findFirst.mockResolvedValue({ status: 'inactive', config: {}, secrets: 'cipher' })
    await ensureGitHubWebhookForIntegration({ integrationId })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('returns early when ownerRepo or secrets are missing', async () => {
    mocks.findFirst.mockResolvedValue({ status: 'active', config: {}, secrets: null })
    await ensureGitHubWebhookForIntegration({ integrationId })
    expect(mocks.decryptSecrets).not.toHaveBeenCalled()
  })

  it('returns early when the decrypted access token is missing', async () => {
    mocks.findFirst.mockResolvedValue({
      status: 'active',
      config: { channelId: 'org/repo' },
      secrets: 'cipher',
    })
    mocks.decryptSecrets.mockReturnValue({})
    await ensureGitHubWebhookForIntegration({ integrationId })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('repairs an existing hook and persists the events version', async () => {
    mocks.findFirst.mockResolvedValue({
      status: 'active',
      config: {
        channelId: 'org/repo',
        externalWebhookId: '42',
        webhookSecret: 'existing-secret',
      },
      secrets: 'cipher',
    })
    mocks.decryptSecrets.mockReturnValue({ accessToken: 'gh_token' })
    // ensureGitHubWebhookEvents -> PATCH succeeds
    const fetchMock = mockFetch(200, {})
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await ensureGitHubWebhookForIntegration({ integrationId })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/org/repo/hooks/42',
      expect.objectContaining({ method: 'PATCH' })
    )
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          webhookSecret: 'existing-secret',
          githubWebhookEventsVersion: GITHUB_WEBHOOK_EVENTS_VERSION,
        }),
      })
    )
    // No replacement registered -> only the PATCH call
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rethrows non-404 errors from the repair attempt', async () => {
    mocks.findFirst.mockResolvedValue({
      status: 'active',
      config: {
        channelId: 'org/repo',
        externalWebhookId: '42',
        webhookSecret: 'existing-secret',
      },
      secrets: 'cipher',
    })
    mocks.decryptSecrets.mockReturnValue({ accessToken: 'gh_token' })
    // PATCH returns 500 -> ensureGitHubWebhookEvents throws "GitHub API error 500"
    const fetchMock = mockFetch(500, 'boom')
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await expect(ensureGitHubWebhookForIntegration({ integrationId })).rejects.toThrow(
      /GitHub API error 500/
    )
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('registers a replacement hook when the existing one is gone (404)', async () => {
    mocks.findFirst.mockResolvedValue({
      status: 'active',
      config: {
        channelId: 'org/repo',
        externalWebhookId: '42',
        webhookSecret: 'existing-secret',
      },
      secrets: 'cipher',
    })
    mocks.decryptSecrets.mockReturnValue({ accessToken: 'gh_token' })

    let call = 0
    const fetchMock = vi.fn().mockImplementation(async () => {
      call += 1
      if (call === 1) {
        // PATCH -> 404 not found
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
          text: async () => 'not found',
        }
      }
      // POST register -> success
      return {
        ok: true,
        status: 201,
        json: async () => ({ id: 555 }),
        text: async () => JSON.stringify({ id: 555 }),
      }
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await ensureGitHubWebhookForIntegration({ integrationId })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.github.com/repos/org/repo/hooks')
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          externalWebhookId: '555',
          webhookSecret: 'existing-secret',
          githubWebhookEventsVersion: GITHUB_WEBHOOK_EVENTS_VERSION,
        }),
      })
    )
  })

  it('registers a fresh hook when none exists yet', async () => {
    mocks.findFirst.mockResolvedValue({
      status: 'active',
      config: { channelId: 'org/repo' },
      secrets: 'cipher',
    })
    mocks.decryptSecrets.mockReturnValue({ accessToken: 'gh_token' })
    const fetchMock = mockFetch(201, { id: 777 })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await ensureGitHubWebhookForIntegration({ integrationId })

    expect(mocks.generateWebhookSecret).toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/org/repo/hooks',
      expect.objectContaining({ method: 'POST' })
    )
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          externalWebhookId: '777',
          webhookSecret: 'generated-secret',
          githubWebhookEventsVersion: GITHUB_WEBHOOK_EVENTS_VERSION,
        }),
      })
    )
  })
})
