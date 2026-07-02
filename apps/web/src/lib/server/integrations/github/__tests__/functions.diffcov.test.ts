import { describe, it, expect, vi, beforeEach } from 'vitest'

type AnyHandler = (args: { data?: Record<string, unknown> }) => Promise<unknown>
const handlers: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      inputValidator() {
        return chain
      },
      validator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockGetRequestHeaders: vi.fn(),
  mockHasPlatformCredentials: vi.fn(),
  mockGetIntegration: vi.fn(),
  mockFindMany: vi.fn(),
  mockUpdate: vi.fn(),
  mockUpdateSet: vi.fn(),
  mockUpdateWhere: vi.fn(),
  mockEq: vi.fn((a: unknown, b: unknown) => ({ a, b })),
  mockDecryptSecrets: vi.fn(),
  mockEnsureGitHubWebhookEvents: vi.fn(),
  mockEnsureGitHubWebhookForIntegration: vi.fn(),
  mockEnsureGitHubEventMappings: vi.fn(),
  mockBuildWebhookCallbackUrl: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.mockRequireAuth,
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: hoisted.mockGetRequestHeaders,
}))

vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  hasPlatformCredentials: hoisted.mockHasPlatformCredentials,
}))

vi.mock('@/lib/server/integrations', () => ({
  getIntegration: hoisted.mockGetIntegration,
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      integrations: {
        findMany: hoisted.mockFindMany,
      },
    },
    update: hoisted.mockUpdate,
  },
  integrations: { id: 'integrations.id', integrationType: 'integrations.integrationType' },
  eq: hoisted.mockEq,
}))

vi.mock('@/lib/server/integrations/encryption', () => ({
  decryptSecrets: hoisted.mockDecryptSecrets,
}))

vi.mock('@/lib/server/integrations/github/webhook-registration', () => ({
  ensureGitHubWebhookEvents: hoisted.mockEnsureGitHubWebhookEvents,
  ensureGitHubWebhookForIntegration: hoisted.mockEnsureGitHubWebhookForIntegration,
  GITHUB_WEBHOOK_EVENTS_VERSION: 2,
}))

vi.mock('@/lib/server/integrations/github/event-mappings', () => ({
  ensureGitHubEventMappings: hoisted.mockEnsureGitHubEventMappings,
}))

vi.mock('@/lib/server/integrations/webhook-registration', () => ({
  buildWebhookCallbackUrl: hoisted.mockBuildWebhookCallbackUrl,
}))

await import('../functions')

// fetchGitHubIntegrationsFn is the third createServerFn defined in the module.
const fetchGitHubIntegrationsFn = handlers[2]

describe('fetchGitHubIntegrationsFn -> repairGitHubSyncConfiguration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.mockRequireAuth.mockResolvedValue({ principal: { id: 'principal_1' } })
    hoisted.mockGetRequestHeaders.mockReturnValue(new Headers())
    hoisted.mockHasPlatformCredentials.mockResolvedValue(true)
    hoisted.mockGetIntegration.mockReturnValue({ platformCredentials: [{ key: 'clientId' }] })
    hoisted.mockDecryptSecrets.mockReturnValue({ accessToken: 'gh_token' })
    hoisted.mockEnsureGitHubEventMappings.mockResolvedValue(false)
    hoisted.mockEnsureGitHubWebhookEvents.mockResolvedValue(undefined)
    hoisted.mockEnsureGitHubWebhookForIntegration.mockResolvedValue(undefined)
    hoisted.mockBuildWebhookCallbackUrl.mockReturnValue(
      'https://app.example.com/api/integrations/github/webhook'
    )
    hoisted.mockUpdateWhere.mockResolvedValue(undefined)
    hoisted.mockUpdateSet.mockReturnValue({ where: hoisted.mockUpdateWhere })
    hoisted.mockUpdate.mockReturnValue({ set: hoisted.mockUpdateSet })
  })

  it('returns connections and platform credential metadata', async () => {
    hoisted.mockFindMany.mockResolvedValue([])
    const result = (await fetchGitHubIntegrationsFn({})) as {
      connections: unknown[]
      platformCredentialFields: unknown[]
      platformCredentialsConfigured: boolean
    }
    expect(result.connections).toEqual([])
    expect(result.platformCredentialsConfigured).toBe(true)
  })

  it('skips repair for inactive, unconfigured, or array-config connections', async () => {
    hoisted.mockFindMany.mockResolvedValue([
      // inactive -> early return
      {
        id: 'int_inactive',
        status: 'inactive',
        secrets: 'cipher',
        config: { channelId: 'org/repo' },
        eventMappings: [],
        label: 'Inactive',
        lastError: null,
      },
      // active but no ownerRepo -> early return
      {
        id: 'int_no_repo',
        status: 'active',
        secrets: 'cipher',
        config: {},
        eventMappings: [],
        label: 'NoRepo',
        lastError: null,
      },
      // active, repo present, but no secrets -> early return
      {
        id: 'int_no_secrets',
        status: 'active',
        secrets: null,
        config: { channelId: 'org/repo' },
        eventMappings: [],
        label: 'NoSecrets',
        lastError: null,
      },
      // array config -> normalized to {} -> no ownerRepo -> early return
      {
        id: 'int_array_config',
        status: 'active',
        secrets: 'cipher',
        config: ['not', 'an', 'object'],
        eventMappings: [],
        label: 'ArrayConfig',
        lastError: null,
      },
    ])

    await fetchGitHubIntegrationsFn({})

    expect(hoisted.mockEnsureGitHubEventMappings).not.toHaveBeenCalled()
    expect(hoisted.mockEnsureGitHubWebhookForIntegration).not.toHaveBeenCalled()
    expect(hoisted.mockEnsureGitHubWebhookEvents).not.toHaveBeenCalled()
  })

  it('returns early when the decrypted secrets have no access token', async () => {
    hoisted.mockDecryptSecrets.mockReturnValue({})
    hoisted.mockFindMany.mockResolvedValue([
      {
        id: 'int_no_token',
        status: 'active',
        secrets: 'cipher',
        config: { channelId: 'org/repo' },
        eventMappings: [],
        label: 'NoToken',
        lastError: null,
      },
    ])

    await fetchGitHubIntegrationsFn({})

    expect(hoisted.mockEnsureGitHubEventMappings).not.toHaveBeenCalled()
  })

  it('repairs inbound webhooks for inbound/bidirectional sync directions', async () => {
    hoisted.mockFindMany.mockResolvedValue([
      {
        id: 'int_inbound',
        status: 'active',
        secrets: 'cipher',
        config: { channelId: 'org/repo', syncDirection: 'inbound' },
        eventMappings: [],
        label: 'Inbound',
        lastError: null,
      },
    ])

    await fetchGitHubIntegrationsFn({})

    expect(hoisted.mockEnsureGitHubEventMappings).toHaveBeenCalledWith(
      expect.objectContaining({ integrationId: 'int_inbound' })
    )
    expect(hoisted.mockEnsureGitHubWebhookForIntegration).toHaveBeenCalledWith(
      expect.objectContaining({ integrationId: 'int_inbound' })
    )
    expect(hoisted.mockEnsureGitHubWebhookEvents).not.toHaveBeenCalled()
  })

  it('repairs outbound status-sync webhooks and persists the events version', async () => {
    hoisted.mockFindMany.mockResolvedValue([
      {
        id: 'int_outbound',
        status: 'active',
        secrets: 'cipher',
        config: {
          channelId: 'org/repo',
          externalWebhookId: '42',
          statusSyncEnabled: true,
          webhookSecret: 'hook-secret',
        },
        eventMappings: [],
        label: 'Outbound',
        lastError: null,
      },
    ])

    await fetchGitHubIntegrationsFn({})

    expect(hoisted.mockEnsureGitHubWebhookEvents).toHaveBeenCalledWith(
      'gh_token',
      'org/repo',
      '42',
      expect.objectContaining({
        callbackUrl: 'https://app.example.com/api/integrations/github/webhook',
        secret: 'hook-secret',
      })
    )
    expect(hoisted.mockUpdate).toHaveBeenCalled()
    expect(hoisted.mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ githubWebhookEventsVersion: 2 }),
      })
    )
  })

  it('does not register events when status sync is disabled or no webhook id', async () => {
    hoisted.mockFindMany.mockResolvedValue([
      {
        id: 'int_outbound_disabled',
        status: 'active',
        secrets: 'cipher',
        config: { channelId: 'org/repo', statusSyncEnabled: false },
        eventMappings: [],
        label: 'OutboundDisabled',
        lastError: null,
      },
    ])

    await fetchGitHubIntegrationsFn({})

    expect(hoisted.mockEnsureGitHubEventMappings).toHaveBeenCalled()
    expect(hoisted.mockEnsureGitHubWebhookEvents).not.toHaveBeenCalled()
    expect(hoisted.mockUpdate).not.toHaveBeenCalled()
  })

  it('swallows repair errors and logs a warning', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    hoisted.mockEnsureGitHubEventMappings.mockRejectedValue(new Error('repair failed'))
    hoisted.mockFindMany.mockResolvedValue([
      {
        id: 'int_error',
        status: 'active',
        secrets: 'cipher',
        config: { channelId: 'org/repo', syncDirection: 'inbound' },
        eventMappings: [],
        label: 'Error',
        lastError: null,
      },
    ])

    await expect(fetchGitHubIntegrationsFn({})).resolves.toBeDefined()

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to repair sync configuration for integration int_error'),
      expect.any(Error)
    )
    warnSpy.mockRestore()
  })
})
