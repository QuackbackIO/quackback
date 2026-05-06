import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server/db', () => {
  const insertChain = { values: vi.fn().mockResolvedValue(undefined) }
  const updateChain = { set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) }
  const dbMock = {
    query: {
      principal: { findFirst: vi.fn() },
      settings: { findFirst: vi.fn() },
      postStatuses: { findFirst: vi.fn() },
    },
    insert: vi.fn(() => insertChain),
    update: vi.fn(() => updateChain),
  }
  return {
    db: dbMock,
    settings: {},
    principal: { role: 'role' },
    postStatuses: {},
    eq: vi.fn(),
    DEFAULT_STATUSES: [],
  }
})

vi.mock('@/lib/server/auth', () => ({
  getAuth: vi.fn(),
}))

vi.mock('@/lib/server/auth/magic-link-mint', () => ({
  mintMagicLinkUrl: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/settings.helpers', () => ({
  invalidateSettingsCache: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/shared/utils', () => ({
  slugify: (s: string) =>
    s
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, ''),
}))

vi.mock('@quackback/ids', () => ({
  generateId: (prefix: string) => `${prefix}_test`,
}))

import { handleCloudBootstrap } from '../bootstrap'
import { getAuth } from '@/lib/server/auth'
import { mintMagicLinkUrl } from '@/lib/server/auth/magic-link-mint'
import { db } from '@/lib/server/db'

const dbMock = db as unknown as {
  query: {
    principal: { findFirst: ReturnType<typeof vi.fn> }
    settings: { findFirst: ReturnType<typeof vi.fn> }
    postStatuses: { findFirst: ReturnType<typeof vi.fn> }
  }
  insert: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
}

function makeReq(
  opts: {
    body?: unknown
    authHeader?: string | null
  } = {}
): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.authHeader !== null) {
    headers.Authorization = opts.authHeader ?? 'Bearer test-token-123'
  }
  return new Request('https://acme.quackback.io/api/cloud/bootstrap', {
    method: 'POST',
    headers,
    body:
      opts.body === undefined
        ? JSON.stringify({ email: 'founder@acme.com', workspaceName: 'Acme Feedback' })
        : typeof opts.body === 'string'
          ? opts.body
          : JSON.stringify(opts.body),
  })
}

describe('POST /api/cloud/bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CLOUD_BOOTSTRAP_TOKEN = 'test-token-123'
    dbMock.query.principal.findFirst.mockResolvedValue(undefined)
    dbMock.query.settings.findFirst.mockResolvedValue(undefined)
    dbMock.query.postStatuses.findFirst.mockResolvedValue(undefined)
    vi.mocked(mintMagicLinkUrl).mockResolvedValue(
      'https://acme.quackback.io/verify-magic-link?token=test-token&callbackURL=...&errorCallbackURL=...'
    )
  })

  it('404s when CLOUD_BOOTSTRAP_TOKEN env is unset (self-hosted instance)', async () => {
    delete process.env.CLOUD_BOOTSTRAP_TOKEN
    const res = await handleCloudBootstrap({ request: makeReq() })
    expect(res.status).toBe(404)
  })

  it('401s when bearer token does not match', async () => {
    const res = await handleCloudBootstrap({ request: makeReq({ authHeader: 'Bearer wrong' }) })
    expect(res.status).toBe(401)
  })

  it('401s when Authorization header is missing', async () => {
    const res = await handleCloudBootstrap({ request: makeReq({ authHeader: null }) })
    expect(res.status).toBe(401)
  })

  it('400s when body is invalid JSON', async () => {
    const res = await handleCloudBootstrap({ request: makeReq({ body: 'not-json' }) })
    expect(res.status).toBe(400)
  })

  it('400s when required fields are missing', async () => {
    const res = await handleCloudBootstrap({ request: makeReq({ body: { email: 'a@b.c' } }) })
    expect(res.status).toBe(400)
  })

  it('400s when workspaceName slugifies to less than 2 chars', async () => {
    // emoji-only / punctuation-only names slugify to '' — guard against
    // multiple tenants colliding on a literal "workspace" fallback.
    const res = await handleCloudBootstrap({
      request: makeReq({
        body: { email: 'founder@acme.com', workspaceName: '🚀' },
      }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/slug/i) })
  })

  it('409s when a different admin already exists', async () => {
    dbMock.query.principal.findFirst.mockResolvedValueOnce({
      id: 'principal_1',
      role: 'admin',
      user: { id: 'user_other', email: 'someone-else@example.com' },
    })
    const res = await handleCloudBootstrap({ request: makeReq() })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/already configured/i) })
  })

  it('returns claimUrl on success — fresh tenant', async () => {
    const signUpEmailMock = vi
      .fn()
      .mockResolvedValue({ user: { id: 'user_admin1', email: 'founder@acme.com' } })
    vi.mocked(getAuth).mockResolvedValue({
      api: { signUpEmail: signUpEmailMock },
    } as never)
    vi.mocked(mintMagicLinkUrl).mockResolvedValueOnce(
      'https://acme.quackback.io/verify-magic-link?token=fresh'
    )

    const res = await handleCloudBootstrap({ request: makeReq() })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { claimUrl: string; userId: string }
    expect(json.claimUrl).toBe('https://acme.quackback.io/verify-magic-link?token=fresh')
    expect(json.userId).toBe('user_admin1')
    expect(signUpEmailMock).toHaveBeenCalledOnce()
    // The error path should land on /admin/login, not the deep page,
    // so a failed verify doesn't double-bounce through the route guard.
    expect(mintMagicLinkUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'founder@acme.com',
        callbackPath: '/admin/feedback',
        errorCallbackPath: '/admin/login',
        portalUrl: 'https://acme.quackback.io',
      })
    )
  })

  it('idempotent — re-bootstrap with same email returns a fresh claimUrl, no second signup', async () => {
    dbMock.query.principal.findFirst.mockResolvedValueOnce({
      id: 'principal_existing',
      role: 'admin',
      user: { id: 'user_existing', email: 'founder@acme.com' },
    })
    const signUpEmailMock = vi.fn() // should NOT be called this time
    vi.mocked(getAuth).mockResolvedValue({
      api: { signUpEmail: signUpEmailMock },
    } as never)
    vi.mocked(mintMagicLinkUrl).mockResolvedValueOnce(
      'https://acme.quackback.io/verify-magic-link?token=replay'
    )

    const res = await handleCloudBootstrap({ request: makeReq() })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { claimUrl: string; userId: string }
    expect(json.userId).toBe('user_existing')
    expect(json.claimUrl).toBe('https://acme.quackback.io/verify-magic-link?token=replay')
    expect(signUpEmailMock).not.toHaveBeenCalled()
  })

  it('500s when mintMagicLinkUrl throws', async () => {
    vi.mocked(getAuth).mockResolvedValue({
      api: { signUpEmail: vi.fn().mockResolvedValue({ user: { id: 'user_admin1' } }) },
    } as never)
    vi.mocked(mintMagicLinkUrl).mockRejectedValueOnce(new Error('Magic link token not captured'))

    await expect(handleCloudBootstrap({ request: makeReq() })).rejects.toThrow(
      /Magic link token not captured/
    )
  })
})
