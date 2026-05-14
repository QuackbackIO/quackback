import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/server/db', () => {
  const chain = { set: () => ({ where: vi.fn() }) }
  const tx = { update: () => chain }
  return {
    db: {
      query: {
        settings: {
          findFirst: vi.fn().mockResolvedValue({ id: 's1', authConfig: '{"oauth":{}}' }),
        },
      },
      update: () => chain,
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
      select: () => ({
        from: () => ({
          limit: () => Promise.resolve([]),
          orderBy: () => Promise.resolve([]),
        }),
      }),
    },
    eq: vi.fn(),
    settings: { id: 'id', authConfig: 'auth_config' },
    ssoVerifiedDomain: { id: 'id', createdAt: 'created_at' },
  }
})

vi.mock('@/lib/server/redis', () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn(),
  cacheDel: vi.fn(),
  CACHE_KEYS: { TENANT_SETTINGS: 'tenant' },
}))

vi.mock('@/lib/server/config-file/managed-guard', () => ({ assertNotManaged: vi.fn() }))

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn().mockResolvedValue({ features: { customOidcProvider: true } }),
}))

vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({ enforceFeatureGate: vi.fn() }))

vi.mock('@/lib/server/content/ssrf-guard', () => ({
  checkUrlSafety: vi.fn().mockResolvedValue({ safe: true }),
}))

vi.mock('@/lib/server/auth/sso-secret', () => ({
  hasSsoClientSecret: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/server/auth/config-version', () => ({
  bumpAuthConfigVersionInTx: vi.fn(),
}))

vi.mock('@/lib/server/auth', () => ({ resetAuth: vi.fn() }))

describe('updateAuthConfig — autoProvisionRole validation', () => {
  it('rejects autoProvisionRole values outside the enum', async () => {
    const { updateAuthConfig } = await import('../settings.service')
    await expect(
      updateAuthConfig({
        ssoOidc: { autoProvisionRole: 'root' as unknown as 'admin' },
      })
    ).rejects.toThrow(/autoProvisionRole/i)
  })

  it('accepts admin | member | user', async () => {
    const { updateAuthConfig } = await import('../settings.service')
    for (const role of ['admin', 'member', 'user'] as const) {
      await expect(
        updateAuthConfig({ ssoOidc: { autoProvisionRole: role } })
      ).resolves.toBeDefined()
    }
  })
})

describe('updateAuthConfigSchema — Zod boundary accepts autoProvisionRole', () => {
  it('parses ssoOidc.autoProvisionRole through the strict server-fn schema', async () => {
    const { updateAuthConfigSchema } = await import('@/lib/server/functions/settings')
    for (const role of ['admin', 'member', 'user'] as const) {
      const parsed = updateAuthConfigSchema.parse({
        ssoOidc: { autoProvisionRole: role },
      })
      expect(parsed.ssoOidc?.autoProvisionRole).toBe(role)
    }
  })

  it('rejects autoProvisionRole values outside the enum', async () => {
    const { updateAuthConfigSchema } = await import('@/lib/server/functions/settings')
    expect(() =>
      updateAuthConfigSchema.parse({
        ssoOidc: { autoProvisionRole: 'root' },
      })
    ).toThrow()
  })
})

describe('updateAuthConfig — 2FA requires password (Option A coupling)', () => {
  // Invariant: `twoFactor.required=true` is only meaningful when
  // `oauth.password=true` because the 2FA gate only runs on password
  // sign-in paths (magic-link / SSO / OAuth bypass it). The data layer
  // refuses to persist the inert combination so downstream code can
  // rely on `twoFactor.required` being load-bearing whenever it's true.

  it('rejects enabling twoFactor.required when oauth.password is already false', async () => {
    const { db } = await import('@/lib/server/db')
    vi.mocked(db.query.settings.findFirst).mockResolvedValueOnce({
      id: 's1',
      authConfig: JSON.stringify({ oauth: { password: false } }),
    } as never)

    const { updateAuthConfig } = await import('../settings.service')
    await expect(updateAuthConfig({ twoFactor: { required: true } })).rejects.toThrow(
      /2FA.*password|password.*2FA|TWO_FACTOR_REQUIRES_PASSWORD/i
    )
  })

  it('rejects disabling oauth.password when twoFactor.required is on', async () => {
    const { db } = await import('@/lib/server/db')
    vi.mocked(db.query.settings.findFirst).mockResolvedValueOnce({
      id: 's1',
      authConfig: JSON.stringify({
        oauth: { password: true },
        twoFactor: { required: true },
      }),
    } as never)

    const { updateAuthConfig } = await import('../settings.service')
    await expect(updateAuthConfig({ oauth: { password: false } })).rejects.toThrow(
      /2FA.*password|password.*2FA|TWO_FACTOR_REQUIRES_PASSWORD/i
    )
  })

  it('accepts disabling oauth.password and twoFactor.required atomically in one call', async () => {
    const { db } = await import('@/lib/server/db')
    vi.mocked(db.query.settings.findFirst).mockResolvedValueOnce({
      id: 's1',
      authConfig: JSON.stringify({
        oauth: { password: true },
        twoFactor: { required: true },
      }),
    } as never)

    const { updateAuthConfig } = await import('../settings.service')
    await expect(
      updateAuthConfig({
        oauth: { password: false },
        twoFactor: { required: false },
      })
    ).resolves.toBeDefined()
  })

  it('accepts enabling oauth.password and twoFactor.required atomically (fresh setup)', async () => {
    const { db } = await import('@/lib/server/db')
    vi.mocked(db.query.settings.findFirst).mockResolvedValueOnce({
      id: 's1',
      authConfig: JSON.stringify({ oauth: { password: false } }),
    } as never)

    const { updateAuthConfig } = await import('../settings.service')
    await expect(
      updateAuthConfig({
        oauth: { password: true },
        twoFactor: { required: true },
      })
    ).resolves.toBeDefined()
  })

  it('accepts enabling twoFactor.required when password is already on (common case)', async () => {
    const { db } = await import('@/lib/server/db')
    vi.mocked(db.query.settings.findFirst).mockResolvedValueOnce({
      id: 's1',
      authConfig: JSON.stringify({ oauth: { password: true } }),
    } as never)

    const { updateAuthConfig } = await import('../settings.service')
    await expect(updateAuthConfig({ twoFactor: { required: true } })).resolves.toBeDefined()
  })

  it('treats absent password key as enabled (default-true per DEFAULT_AUTH_CONFIG)', async () => {
    // Pre-migration tenant: oauth has no `password` key. Per the
    // existing default-true contract, password is considered ON, so
    // enabling 2FA is permitted.
    const { db } = await import('@/lib/server/db')
    vi.mocked(db.query.settings.findFirst).mockResolvedValueOnce({
      id: 's1',
      authConfig: JSON.stringify({ oauth: {} }),
    } as never)

    const { updateAuthConfig } = await import('../settings.service')
    await expect(updateAuthConfig({ twoFactor: { required: true } })).resolves.toBeDefined()
  })

  it('rejects unrelated saves while the stored state is inert (forces explicit cleanup)', async () => {
    // Migration 0061 normalizes existing inert state at deploy time,
    // but the validator must still refuse the combination on writes —
    // belt-and-braces in case a future write reintroduces it via
    // direct DB manipulation or a third-party tool.
    const { db } = await import('@/lib/server/db')
    vi.mocked(db.query.settings.findFirst).mockResolvedValueOnce({
      id: 's1',
      authConfig: JSON.stringify({
        oauth: { password: false, magicLink: true },
        twoFactor: { required: true },
      }),
    } as never)

    const { updateAuthConfig } = await import('../settings.service')
    // Touching only openSignup must still trip the invariant because
    // the resulting state is still inert.
    await expect(updateAuthConfig({ openSignup: true })).rejects.toThrow(
      /password.*2FA|2FA.*password/i
    )
  })
})
