import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  settingsSelect: vi.fn(),
  settingsUpdate: vi.fn(),
  settingsInsert: vi.fn(),
  invalidateCache: vi.fn(),
}))

vi.mock('@/lib/server/db', async () => {
  const drizzle = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')
  return {
    db: {
      select: () => ({
        from: () => ({ limit: () => hoisted.settingsSelect() }),
      }),
      update: () => ({
        set: () => ({ where: () => hoisted.settingsUpdate() }),
      }),
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => hoisted.settingsInsert(),
        }),
      }),
    },
    settings: { __name: 'settings', id: 'id', slug: 'slug' },
    eq: drizzle.eq,
  }
})

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  invalidateTierLimitsCache: () => hoisted.invalidateCache(),
}))

import { pullBootConfig } from '../pull-boot-config'

const VALID_LIMITS = {
  maxBoards: 5,
  maxPosts: 100,
  maxTeamSeats: 3,
  aiTokensPerMonth: 10_000,
  apiRequestsPerMonth: null,
  apiRequestsPerMinute: 60,
  features: {
    customDomain: false,
    customOidcProvider: false,
    ipAllowlist: false,
    webhooks: true,
    mcpServer: false,
    analyticsExports: false,
    customColors: true,
    customCss: false,
    integrations: true,
  },
}

function mockFetchOk(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (_url, _init) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    )
  )
}

function mockFetchStatus(status: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('nope', { status }))
  )
}

describe('pullBootConfig (Stage 3A)', () => {
  let originalUrl: string | undefined
  let originalToken: string | undefined
  beforeEach(() => {
    vi.clearAllMocks()
    originalUrl = process.env.QUACKBACK_CONFIG_PROVIDER_URL
    originalToken = process.env.QUACKBACK_CONFIG_PROVIDER_TOKEN
    delete process.env.QUACKBACK_CONFIG_PROVIDER_URL
    delete process.env.QUACKBACK_CONFIG_PROVIDER_TOKEN
    vi.unstubAllGlobals()
  })
  afterEach(() => {
    if (originalUrl === undefined) delete process.env.QUACKBACK_CONFIG_PROVIDER_URL
    else process.env.QUACKBACK_CONFIG_PROVIDER_URL = originalUrl
    if (originalToken === undefined) delete process.env.QUACKBACK_CONFIG_PROVIDER_TOKEN
    else process.env.QUACKBACK_CONFIG_PROVIDER_TOKEN = originalToken
    vi.unstubAllGlobals()
  })

  it('is a no-op when env vars are unset (self-host parity)', async () => {
    await pullBootConfig()
    expect(hoisted.settingsSelect).not.toHaveBeenCalled()
  })

  it('is a no-op when only URL is set without token', async () => {
    process.env.QUACKBACK_CONFIG_PROVIDER_URL = 'http://test/x'
    await pullBootConfig()
    expect(hoisted.settingsSelect).not.toHaveBeenCalled()
  })

  it('updates the existing settings row when tierLimits.version=1 and a row exists', async () => {
    process.env.QUACKBACK_CONFIG_PROVIDER_URL = 'http://test/x'
    process.env.QUACKBACK_CONFIG_PROVIDER_TOKEN = 'tok'
    mockFetchOk({ tierLimits: { version: '1', limits: VALID_LIMITS } })
    hoisted.settingsSelect.mockResolvedValue([{ id: 1 }])
    hoisted.settingsUpdate.mockResolvedValue(undefined)

    await pullBootConfig()

    expect(hoisted.settingsUpdate).toHaveBeenCalledOnce()
    expect(hoisted.settingsInsert).not.toHaveBeenCalled()
    expect(hoisted.invalidateCache).toHaveBeenCalledOnce()
  })

  it('inserts a settings row when none exists (pre-onboarding)', async () => {
    process.env.QUACKBACK_CONFIG_PROVIDER_URL = 'http://test/x'
    process.env.QUACKBACK_CONFIG_PROVIDER_TOKEN = 'tok'
    mockFetchOk({ tierLimits: { version: '1', limits: VALID_LIMITS } })
    hoisted.settingsSelect.mockResolvedValue([])
    hoisted.settingsInsert.mockResolvedValue(undefined)

    await pullBootConfig()

    expect(hoisted.settingsInsert).toHaveBeenCalledOnce()
    expect(hoisted.settingsUpdate).not.toHaveBeenCalled()
  })

  it('ignores tierLimits with an unknown version (forward-compat)', async () => {
    process.env.QUACKBACK_CONFIG_PROVIDER_URL = 'http://test/x'
    process.env.QUACKBACK_CONFIG_PROVIDER_TOKEN = 'tok'
    mockFetchOk({ tierLimits: { version: '99', limits: VALID_LIMITS } })

    await pullBootConfig()

    expect(hoisted.settingsSelect).not.toHaveBeenCalled()
    expect(hoisted.invalidateCache).not.toHaveBeenCalled()
  })

  it('ignores empty/missing limits inside tierLimits', async () => {
    process.env.QUACKBACK_CONFIG_PROVIDER_URL = 'http://test/x'
    process.env.QUACKBACK_CONFIG_PROVIDER_TOKEN = 'tok'
    mockFetchOk({ tierLimits: { version: '1' } })

    await pullBootConfig()

    expect(hoisted.settingsSelect).not.toHaveBeenCalled()
  })

  it('does not throw when fetch returns non-2xx (boot must not block)', async () => {
    process.env.QUACKBACK_CONFIG_PROVIDER_URL = 'http://test/x'
    process.env.QUACKBACK_CONFIG_PROVIDER_TOKEN = 'tok'
    mockFetchStatus(503)

    await expect(pullBootConfig()).resolves.toBeUndefined()
    expect(hoisted.settingsSelect).not.toHaveBeenCalled()
  })

  it('does not throw when fetch rejects', async () => {
    process.env.QUACKBACK_CONFIG_PROVIDER_URL = 'http://test/x'
    process.env.QUACKBACK_CONFIG_PROVIDER_TOKEN = 'tok'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      })
    )

    await expect(pullBootConfig()).resolves.toBeUndefined()
  })

  it('survives unknown top-level sections (forward-compat)', async () => {
    process.env.QUACKBACK_CONFIG_PROVIDER_URL = 'http://test/x'
    process.env.QUACKBACK_CONFIG_PROVIDER_TOKEN = 'tok'
    mockFetchOk({
      tierLimits: { version: '1', limits: VALID_LIMITS },
      futureSection: { hello: 'world' },
    })
    hoisted.settingsSelect.mockResolvedValue([{ id: 1 }])

    await expect(pullBootConfig()).resolves.toBeUndefined()
    expect(hoisted.settingsUpdate).toHaveBeenCalledOnce()
  })
})
