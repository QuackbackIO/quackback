import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicWidgetConfig } from '@/lib/server/domains/settings'

const mocks = vi.hoisted(() => ({
  widgetEnvProfilesFindFirst: vi.fn(),
  widgetApplicationsFindFirst: vi.fn(),
  getPublicWidgetConfig: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      widgetEnvironmentProfiles: {
        findFirst: (...args: unknown[]) => mocks.widgetEnvProfilesFindFirst(...args),
      },
      widgetApplications: {
        findFirst: (...args: unknown[]) => mocks.widgetApplicationsFindFirst(...args),
      },
    },
  },
  eq: vi.fn((a: unknown, b: unknown) => ({ op: 'eq', a, b })),
  and: vi.fn((...conds: unknown[]) => ({ op: 'and', conds })),
  isNull: vi.fn((a: unknown) => ({ op: 'isNull', a })),
  widgetApplications: {
    key: 'widgetApplications.key',
    archivedAt: 'widgetApplications.archivedAt',
  },
  widgetEnvironmentProfiles: {
    id: 'widgetEnvironmentProfiles.id',
    archivedAt: 'widgetEnvironmentProfiles.archivedAt',
  },
}))

vi.mock('@/lib/server/domains/settings/settings.widget', () => ({
  getPublicWidgetConfig: (...args: unknown[]) => mocks.getPublicWidgetConfig(...args),
  // Keep a faithful projection so resolveWidgetContext's chat-merge path runs.
  publicLiveChatConfig: (chat: Record<string, unknown>) => ({
    enabled: chat.enabled,
    welcomeMessage: chat.welcomeMessage,
    offlineMessage: chat.offlineMessage,
    teamName: chat.teamName,
    officeHours: chat.officeHours,
    preChatEmail: chat.preChatEmail,
  }),
}))

const baseConfig: PublicWidgetConfig = {
  enabled: true,
  defaultBoard: 'general',
  position: 'bottom-right',
  tabs: { feedback: true, changelog: false, chat: false, home: true },
  imageUploadsInWidget: true,
  ticketing: { enabled: false },
  hmacRequired: false,
  chat: { enabled: false },
} as unknown as PublicWidgetConfig

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('BASE_URL', 'http://localhost:3000')
  vi.stubEnv('DATABASE_URL', 'postgres://user:pass@localhost:5432/test')
  vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
  vi.stubEnv('SECRET_KEY', 'test-secret-key-that-is-at-least-32-characters-long')
  mocks.getPublicWidgetConfig.mockResolvedValue(baseConfig)
})

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://example.com/widget', { headers })
}

describe('WidgetContextError', () => {
  it('sets name and code on construction', async () => {
    const { WidgetContextError } = await import('../context')
    const err = new WidgetContextError('INVALID_WIDGET_CONTEXT', 'bad')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('WidgetContextError')
    expect(err.code).toBe('INVALID_WIDGET_CONTEXT')
    expect(err.message).toBe('bad')
  })
})

describe('verifyWidgetContextFromRequest', () => {
  it('returns null when header is absent', async () => {
    const { verifyWidgetContextFromRequest } = await import('../context')
    expect(verifyWidgetContextFromRequest(makeRequest())).toBeNull()
  })

  it('returns claims when a valid token header is present', async () => {
    const { createWidgetContextToken, verifyWidgetContextFromRequest } = await import('../context')
    const token = createWidgetContextToken({ applicationKey: 'app-x' })
    const claims = verifyWidgetContextFromRequest(
      makeRequest({ 'x-quackback-widget-context': token })
    )
    expect(claims).toMatchObject({ applicationKey: 'app-x' })
  })
})

describe('getWidgetRequestContext', () => {
  it('returns empty context when no token header', async () => {
    const { getWidgetRequestContext } = await import('../context')
    const result = await getWidgetRequestContext(makeRequest())
    expect(result).toEqual({ claims: null, contentFilters: {}, supportConfig: {} })
    expect(mocks.widgetEnvProfilesFindFirst).not.toHaveBeenCalled()
  })

  it('throws INVALID_WIDGET_CONTEXT when token is present but invalid', async () => {
    const { getWidgetRequestContext, WidgetContextError } = await import('../context')
    await expect(
      getWidgetRequestContext(makeRequest({ 'x-quackback-widget-context': 'not-a-valid-token' }))
    ).rejects.toMatchObject({ code: 'INVALID_WIDGET_CONTEXT' })
    // sanity: it's the typed error
    await getWidgetRequestContext(makeRequest({ 'x-quackback-widget-context': 'bad.bad' })).catch(
      (e) => {
        expect(e).toBeInstanceOf(WidgetContextError)
      }
    )
  })

  it('returns claims without DB lookup when token has no profileId', async () => {
    const { createWidgetContextToken, getWidgetRequestContext } = await import('../context')
    const token = createWidgetContextToken({
      applicationKey: 'app-1',
      environment: 'prod',
    })
    const result = await getWidgetRequestContext(
      makeRequest({ 'x-quackback-widget-context': token })
    )
    expect(result.applicationKey).toBe('app-1')
    expect(result.environment).toBe('prod')
    expect(result.contentFilters).toEqual({})
    expect(result.supportConfig).toEqual({})
    expect(result.profileId).toBeUndefined()
    expect(mocks.widgetEnvProfilesFindFirst).not.toHaveBeenCalled()
  })

  it('throws WIDGET_PROFILE_NOT_FOUND when profile is missing', async () => {
    const { createWidgetContextToken, getWidgetRequestContext } = await import('../context')
    mocks.widgetEnvProfilesFindFirst.mockResolvedValue(undefined)
    const token = createWidgetContextToken({
      profileId: 'wprofile_missing' as never,
      applicationKey: 'app-1',
    })
    await expect(
      getWidgetRequestContext(makeRequest({ 'x-quackback-widget-context': token }))
    ).rejects.toMatchObject({ code: 'WIDGET_PROFILE_NOT_FOUND' })
  })

  it('throws WIDGET_PROFILE_DISABLED when profile is disabled', async () => {
    const { createWidgetContextToken, getWidgetRequestContext } = await import('../context')
    mocks.widgetEnvProfilesFindFirst.mockResolvedValue({
      id: 'wprofile_1',
      enabled: false,
      contentFilters: {},
      supportConfig: {},
    })
    const token = createWidgetContextToken({ profileId: 'wprofile_1' as never })
    await expect(
      getWidgetRequestContext(makeRequest({ 'x-quackback-widget-context': token }))
    ).rejects.toMatchObject({ code: 'WIDGET_PROFILE_DISABLED' })
  })

  it('returns resolved profile context for an enabled profile', async () => {
    const { createWidgetContextToken, getWidgetRequestContext } = await import('../context')
    mocks.widgetEnvProfilesFindFirst.mockResolvedValue({
      id: 'wprofile_2',
      enabled: true,
      contentFilters: { boards: ['general'] },
      supportConfig: { ticketListScope: 'requester_owned' },
    })
    const token = createWidgetContextToken({
      profileId: 'wprofile_2' as never,
      applicationKey: 'app-2',
      environment: 'staging',
    })
    const result = await getWidgetRequestContext(
      makeRequest({ 'x-quackback-widget-context': token })
    )
    expect(result.profileId).toBe('wprofile_2')
    expect(result.applicationKey).toBe('app-2')
    expect(result.environment).toBe('staging')
    expect(result.contentFilters).toEqual({ boards: ['general'] })
    expect(result.supportConfig).toEqual({ ticketListScope: 'requester_owned' })
  })

  it('falls back to empty content/support config when profile fields are null', async () => {
    const { createWidgetContextToken, getWidgetRequestContext } = await import('../context')
    mocks.widgetEnvProfilesFindFirst.mockResolvedValue({
      id: 'wprofile_3',
      enabled: true,
      contentFilters: null,
      supportConfig: null,
    })
    const token = createWidgetContextToken({ profileId: 'wprofile_3' as never })
    const result = await getWidgetRequestContext(
      makeRequest({ 'x-quackback-widget-context': token })
    )
    expect(result.contentFilters).toEqual({})
    expect(result.supportConfig).toEqual({})
  })
})

describe('resolveWidgetContext', () => {
  it('returns global source when no applicationKey and no environment', async () => {
    const { resolveWidgetContext } = await import('../context')
    const result = await resolveWidgetContext(makeRequest(), {})
    expect(result.source).toBe('global')
    expect(result.publicConfig).toEqual(baseConfig)
    expect(result.contentFilters).toEqual({})
    expect(result.supportConfig).toEqual({})
    expect(typeof result.contextToken).toBe('string')
  })

  it('normalizes identifiers (lowercase + sanitize) on the empty token branch', async () => {
    const { resolveWidgetContext } = await import('../context')
    // Only applicationKey present -> missing_profile disabled branch
    const result = await resolveWidgetContext(makeRequest(), { applicationKey: 'My App!' })
    expect(result.source).toBe('disabled')
    expect(result.denialReason).toBe('missing_profile')
    expect(result.applicationKey).toBe('my-app-')
    expect(result.publicConfig.enabled).toBe(false)
  })

  it('returns missing_profile when only environment is present', async () => {
    const { resolveWidgetContext } = await import('../context')
    const result = await resolveWidgetContext(makeRequest(), { environment: 'Prod' })
    expect(result.source).toBe('disabled')
    expect(result.denialReason).toBe('missing_profile')
    expect(result.environment).toBe('prod')
  })

  it('returns missing_profile when app is not found', async () => {
    const { resolveWidgetContext } = await import('../context')
    mocks.widgetApplicationsFindFirst.mockResolvedValue(undefined)
    const result = await resolveWidgetContext(makeRequest(), {
      applicationKey: 'app-1',
      environment: 'prod',
    })
    expect(result.source).toBe('disabled')
    expect(result.denialReason).toBe('missing_profile')
  })

  it('returns missing_profile when app has no matching or default profile', async () => {
    const { resolveWidgetContext } = await import('../context')
    mocks.widgetApplicationsFindFirst.mockResolvedValue({
      key: 'app-1',
      profiles: [{ archivedAt: null, environment: 'other-env', enabled: true }],
    })
    const result = await resolveWidgetContext(makeRequest(), {
      applicationKey: 'app-1',
      environment: 'prod',
    })
    expect(result.source).toBe('disabled')
    expect(result.denialReason).toBe('missing_profile')
  })

  it('falls back to the default-environment profile when the exact env is absent', async () => {
    const { resolveWidgetContext } = await import('../context')
    mocks.widgetApplicationsFindFirst.mockResolvedValue({
      key: 'app-1',
      profiles: [
        {
          id: 'wprofile_default',
          archivedAt: null,
          environment: 'default',
          enabled: true,
          allowedOrigins: [],
          configOverrides: {},
          supportConfig: {},
          contentFilters: {},
        },
      ],
    })
    const result = await resolveWidgetContext(makeRequest(), {
      applicationKey: 'app-1',
      environment: 'prod',
    })
    expect(result.source).toBe('profile')
    expect(result.profileId).toBe('wprofile_default')
    expect(result.environment).toBe('default')
  })

  it('returns profile_disabled when the matched profile is disabled', async () => {
    const { resolveWidgetContext } = await import('../context')
    mocks.widgetApplicationsFindFirst.mockResolvedValue({
      key: 'app-1',
      profiles: [
        {
          id: 'wprofile_x',
          archivedAt: null,
          environment: 'prod',
          enabled: false,
          allowedOrigins: [],
        },
      ],
    })
    const result = await resolveWidgetContext(makeRequest(), {
      applicationKey: 'app-1',
      environment: 'prod',
    })
    expect(result.source).toBe('disabled')
    expect(result.denialReason).toBe('profile_disabled')
  })

  it('returns origin_denied when request origin is not in the allowlist', async () => {
    const { resolveWidgetContext } = await import('../context')
    mocks.widgetApplicationsFindFirst.mockResolvedValue({
      key: 'app-1',
      profiles: [
        {
          id: 'wprofile_y',
          archivedAt: null,
          environment: 'prod',
          enabled: true,
          allowedOrigins: ['https://allowed.example.com'],
          configOverrides: {},
          supportConfig: {},
          contentFilters: {},
        },
      ],
    })
    const result = await resolveWidgetContext(makeRequest({ origin: 'https://evil.example.com' }), {
      applicationKey: 'app-1',
      environment: 'prod',
    })
    expect(result.source).toBe('disabled')
    expect(result.denialReason).toBe('origin_denied')
  })

  it('resolves a profile and merges config overrides (chat + identifyVerification)', async () => {
    const { resolveWidgetContext, verifyWidgetContextToken } = await import('../context')
    mocks.widgetApplicationsFindFirst.mockResolvedValue({
      key: 'app-1',
      profiles: [
        {
          id: 'wprofile_z',
          archivedAt: null,
          environment: 'prod',
          enabled: true,
          allowedOrigins: ['https://allowed.example.com'],
          configOverrides: {
            identifyVerification: true,
            chat: { enabled: true, welcomeMessage: 'Hello there' },
          },
          supportConfig: {
            ticketListScope: 'same_profile_allowed_inboxes',
            categories: [
              { inboxId: 'inbox_a', visible: true },
              { inboxId: 'inbox_b', visible: false },
              { inboxId: 'inbox_a', visible: true },
              { inboxId: '', visible: true },
            ],
          },
          contentFilters: { boards: ['general'] },
        },
      ],
    })
    const result = await resolveWidgetContext(
      makeRequest({ origin: 'https://allowed.example.com' }),
      { applicationKey: 'app-1', environment: 'prod' }
    )
    expect(result.source).toBe('profile')
    expect(result.profileId).toBe('wprofile_z')
    expect(result.environment).toBe('prod')
    expect(result.publicConfig.hmacRequired).toBe(true)
    expect(result.publicConfig.chat?.enabled).toBe(true)
    expect(result.publicConfig.chat?.welcomeMessage).toBe('Hello there')
    expect(result.contentFilters).toEqual({ boards: ['general'] })

    // Token should encode deduped, visible-only, non-empty inbox ids + scope.
    const claims = verifyWidgetContextToken(result.contextToken)
    expect(claims?.profileId).toBe('wprofile_z')
    expect(claims?.allowedInboxIds).toEqual(['inbox_a'])
    expect(claims?.ticketListScope).toBe('same_profile_allowed_inboxes')
  })

  it('resolves a profile with no overrides and defaults (null configOverrides/supportConfig)', async () => {
    const { resolveWidgetContext, verifyWidgetContextToken } = await import('../context')
    mocks.widgetApplicationsFindFirst.mockResolvedValue({
      key: 'app-1',
      profiles: [
        {
          id: 'wprofile_w',
          archivedAt: null,
          environment: 'prod',
          enabled: true,
          allowedOrigins: [],
          configOverrides: null,
          supportConfig: null,
          contentFilters: null,
        },
      ],
    })
    const result = await resolveWidgetContext(makeRequest(), {
      applicationKey: 'app-1',
      environment: 'prod',
    })
    expect(result.source).toBe('profile')
    expect(result.supportConfig).toEqual({})
    expect(result.contentFilters).toEqual({})
    const claims = verifyWidgetContextToken(result.contextToken)
    // default ticket list scope applied
    expect(claims?.ticketListScope).toBe('requester_owned')
    expect(claims?.allowedInboxIds).toEqual([])
  })

  it('uses referer/host fallback when no origin header is sent', async () => {
    const { resolveWidgetContext } = await import('../context')
    mocks.widgetApplicationsFindFirst.mockResolvedValue({
      key: 'app-1',
      profiles: [
        {
          id: 'wprofile_ref',
          archivedAt: null,
          environment: 'prod',
          enabled: true,
          allowedOrigins: ['https://allowed.example.com'],
          configOverrides: {},
          supportConfig: {},
          contentFilters: {},
        },
      ],
    })
    // No origin header, but referer matches -> allowed via requestOrigin referer path.
    const viaReferer = await resolveWidgetContext(
      makeRequest({ referer: 'https://allowed.example.com/some/page' }),
      { applicationKey: 'app-1', environment: 'prod' }
    )
    expect(viaReferer.source).toBe('profile')

    // Neither origin nor referer, but hostOrigin search fallback matches.
    const viaFallback = await resolveWidgetContext(makeRequest(), {
      applicationKey: 'app-1',
      environment: 'prod',
      hostOrigin: 'https://allowed.example.com',
    })
    expect(viaFallback.source).toBe('profile')
  })
})
