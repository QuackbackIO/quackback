/**
 * Verify writes against the domain that is stored now.
 *
 * verifyHelpCenterDomain checks the configured domain and writes
 * `{ domain, verifiedAt }` back. Read-only settings reads may be served from
 * a copy this process holds for a few seconds, so if the domain was changed
 * elsewhere in that window, a verify that read the copy would check the old
 * host and write it back over the new one. The real settings service runs
 * here; only the kv and database statements are faked, over one stored row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const kvRows = new Map<string, unknown>()
vi.mock('@/lib/server/kv/pg-kv', () => ({
  kvGet: vi.fn(async (key: string) => structuredClone(kvRows.get(key) ?? null)),
  kvSet: vi.fn(async (key: string, value: unknown) => void kvRows.set(key, value)),
  kvDel: vi.fn(async (...keys: string[]) => keys.forEach((k) => kvRows.delete(k))),
}))

let stored: Record<string, unknown>
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: { settings: { findFirst: async () => structuredClone(stored) } },
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: async () => void Object.assign(stored, patch),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([]),
        limit: () => Promise.resolve([]),
        orderBy: () => Promise.resolve([]),
      }),
    }),
  },
}))

vi.mock('@/lib/server/storage/s3', () => ({
  getPublicUrlOrNull: (key: string | null) => (key ? `https://cdn.test/${key}` : null),
  resignStoredAssetUrl: (src: string) => src,
  deleteObject: vi.fn(),
}))
vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getConfiguredIntegrationTypes: vi.fn().mockResolvedValue(new Set()),
  getPlatformCredentials: vi.fn().mockResolvedValue(null),
}))
vi.mock('@quackback/email', () => ({ isEmailConfigured: vi.fn().mockReturnValue(false) }))
vi.mock('@/lib/server/auth/auth-providers', () => ({
  getAllAuthProviders: vi.fn().mockReturnValue([]),
}))

const resolvedHosts: string[] = []
vi.mock('node:dns/promises', () => ({
  resolve4: vi.fn(async (host: string) => {
    resolvedHosts.push(host)
    return ['203.0.113.1']
  }),
  resolve6: vi.fn(async () => []),
}))

const { verifyHelpCenterDomain } = await import('../help-center-domain.service')
const { getHelpCenterConfig } = await import('@/lib/server/domains/settings/settings.service')
const { runWithLogContext } = await import('@/lib/server/log-context')
const { forgetCachedKeys } = await import('@/lib/server/local-cache')

const COMPLETE_SETUP = JSON.stringify({
  version: 2,
  steps: {
    core: true,
    workspace: true,
    startingPoint: {
      outcome: 'product_feedback',
      resourceType: 'none',
      source: 'managed',
      resolution: 'configured',
      completedAt: '2026-08-13T00:00:00.000Z',
    },
  },
})

function rowWithDomain(domain: string) {
  return {
    id: 'settings_1',
    name: 'Acme',
    slug: 'acme',
    setupState: COMPLETE_SETUP,
    helpCenterConfig: JSON.stringify({ domain: { domain, verifiedAt: null } }),
  }
}

function inRequest<T>(fn: () => Promise<T>): Promise<T> {
  return runWithLogContext({ request_id: crypto.randomUUID() }, fn)
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('ok'))
  )
  forgetCachedKeys('settings:workspace')
  kvRows.clear()
  resolvedHosts.length = 0
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('verifyHelpCenterDomain', () => {
  it('checks and writes the stored domain, not a cached copy of an older one', async () => {
    stored = rowWithDomain('old.example.com')
    // This process caches the settings, then another process changes the domain.
    expect((await inRequest(() => getHelpCenterConfig())).domain.domain).toBe('old.example.com')
    stored = rowWithDomain('new.example.com')

    const { config } = await inRequest(() => verifyHelpCenterDomain())

    expect(resolvedHosts).toEqual(['new.example.com'])
    expect(config.domain).toBe('new.example.com')
    expect(JSON.parse(stored.helpCenterConfig as string).domain).toMatchObject({
      domain: 'new.example.com',
    })
  })
})
