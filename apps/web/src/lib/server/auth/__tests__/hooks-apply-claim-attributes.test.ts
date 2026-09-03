/**
 * `applyClaimAttributesAfter` — copy mapped IdP claims into person attributes
 * on a successful OAuth callback.
 *
 * Mocks modelled on hooks-sso-callback-after.test.ts / jit-role.test.ts:
 * spread the real db module, override the query/update surface this writer
 * drives. The shared `readClaims` parameter is the take-once stash fix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockUserFindFirst = vi.fn()
const mockAccountFindFirst = vi.fn()
const mockUpdateSet = vi.fn()
const mockUpdateWhere = vi.fn()
const mockSelectFrom = vi.fn()
const mockLogInfo = vi.fn()
const mockLogError = vi.fn()
const mockLogDebug = vi.fn()

vi.mock('@/lib/server/logger', () => ({
  logger: {
    child: () => ({
      info: (...args: unknown[]) => mockLogInfo(...args),
      error: (...args: unknown[]) => mockLogError(...args),
      debug: (...args: unknown[]) => mockLogDebug(...args),
    }),
  },
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      user: { findFirst: (...args: unknown[]) => mockUserFindFirst(...args) },
      account: { findFirst: (...args: unknown[]) => mockAccountFindFirst(...args) },
    },
    select: () => ({ from: (...args: unknown[]) => mockSelectFrom(...args) }),
    update: () => ({
      set: (...args: unknown[]) => {
        mockUpdateSet(...args)
        return { where: mockUpdateWhere }
      },
    }),
  },
}))

const { applyClaimAttributesAfter } = await import('../apply-claim-attributes')

const DEPARTMENT_DEF = { key: 'department', type: 'string' as const }

type Provider = {
  registrationId: string
  claimMapping: unknown
}

function providersWith(over: { claimMapping?: unknown; registrationId?: string } = {}): Provider[] {
  return [
    {
      registrationId: over.registrationId ?? 'sso',
      claimMapping: over.claimMapping ?? {
        attributes: { map: [{ claimPath: 'department', attributeKey: 'department' }] },
      },
    },
  ]
}

function ctxFor(opts: { path?: string; providerId?: string; userId?: string | null } = {}) {
  const userId = opts.userId === null ? undefined : (opts.userId ?? 'user_1')
  return {
    path: opts.path ?? '/oauth2/callback/:providerId',
    params: { providerId: opts.providerId ?? 'sso' },
    context: {
      newSession: userId ? { user: { id: userId } } : null,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdateWhere.mockResolvedValue(undefined)
  mockUserFindFirst.mockResolvedValue({ metadata: null })
  mockSelectFrom.mockResolvedValue([DEPARTMENT_DEF])
  mockAccountFindFirst.mockResolvedValue(null)
})

describe('applyClaimAttributesAfter', () => {
  it('writes user.metadata with the coerced value for a mapped, defined key', async () => {
    await applyClaimAttributesAfter(ctxFor(), providersWith(), new Set(['sso']), async () => ({
      department: 'Engineering',
    }))
    expect(mockUpdateSet).toHaveBeenCalledWith({
      metadata: JSON.stringify({ department: 'Engineering' }),
    })
    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user_1',
        provider_id: 'sso',
        written: ['department'],
        removed: [],
      }),
      'claim attributes written'
    )
  })

  it('ignores an unknown attributeKey and creates nothing', async () => {
    await applyClaimAttributesAfter(
      ctxFor(),
      providersWith({
        claimMapping: { attributes: { map: [{ claimPath: 'department', attributeKey: 'nope' }] } },
      }),
      new Set(['sso']),
      async () => ({ department: 'Engineering' })
    )
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it('keeps an existing value when override is off', async () => {
    mockUserFindFirst.mockResolvedValue({ metadata: JSON.stringify({ department: 'Sales' }) })
    await applyClaimAttributesAfter(ctxFor(), providersWith(), new Set(['sso']), async () => ({
      department: 'Engineering',
    }))
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it('replaces an existing value when override is on', async () => {
    mockUserFindFirst.mockResolvedValue({ metadata: JSON.stringify({ department: 'Sales' }) })
    await applyClaimAttributesAfter(
      ctxFor(),
      providersWith({
        claimMapping: {
          attributes: {
            map: [{ claimPath: 'department', attributeKey: 'department' }],
            overrideExisting: true,
          },
        },
      }),
      new Set(['sso']),
      async () => ({ department: 'Engineering' })
    )
    expect(mockUpdateSet).toHaveBeenCalledWith({
      metadata: JSON.stringify({ department: 'Engineering' }),
    })
  })

  it('syncOnSignIn removes a key whose claim is absent', async () => {
    mockUserFindFirst.mockResolvedValue({ metadata: JSON.stringify({ department: 'Sales' }) })
    await applyClaimAttributesAfter(
      ctxFor(),
      providersWith({
        claimMapping: {
          attributes: {
            map: [{ claimPath: 'department', attributeKey: 'department' }],
            syncOnSignIn: true,
          },
        },
      }),
      new Set(['sso']),
      async () => ({})
    )
    expect(mockUpdateSet).toHaveBeenCalledWith({ metadata: JSON.stringify({}) })
  })

  it('leaves a missing claim alone when sync is off', async () => {
    mockUserFindFirst.mockResolvedValue({ metadata: JSON.stringify({ department: 'Sales' }) })
    await applyClaimAttributesAfter(ctxFor(), providersWith(), new Set(['sso']), async () => ({}))
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it('keeps _externalUserId through the merge', async () => {
    mockUserFindFirst.mockResolvedValue({
      metadata: JSON.stringify({ _externalUserId: 'ext_1' }),
    })
    await applyClaimAttributesAfter(ctxFor(), providersWith(), new Set(['sso']), async () => ({
      department: 'Engineering',
    }))
    expect(mockUpdateSet).toHaveBeenCalledWith({
      metadata: JSON.stringify({ _externalUserId: 'ext_1', department: 'Engineering' }),
    })
  })

  it('does not touch the DB off the callback path', async () => {
    await applyClaimAttributesAfter(
      ctxFor({ path: '/sign-in/email' }),
      providersWith(),
      new Set(['sso']),
      async () => ({ department: 'Engineering' })
    )
    expect(mockUserFindFirst).not.toHaveBeenCalled()
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it('does not touch the DB for an unregistered provider', async () => {
    await applyClaimAttributesAfter(
      ctxFor({ providerId: 'google' }),
      providersWith(),
      new Set(['sso']),
      async () => ({ department: 'Engineering' })
    )
    expect(mockUserFindFirst).not.toHaveBeenCalled()
  })

  it('does not touch the DB when newSession is missing (cleanup revoked the session)', async () => {
    await applyClaimAttributesAfter(
      ctxFor({ userId: null }),
      providersWith(),
      new Set(['sso']),
      async () => ({ department: 'Engineering' })
    )
    expect(mockUserFindFirst).not.toHaveBeenCalled()
  })

  it('throws on a DB error so hooksAfter can swallow it without blocking sign-in', async () => {
    mockUpdateWhere.mockRejectedValue(new Error('db down'))
    await expect(
      applyClaimAttributesAfter(ctxFor(), providersWith(), new Set(['sso']), async () => ({
        department: 'Engineering',
      }))
    ).rejects.toThrow('db down')
  })

  it('shared reader: a take-once source still feeds the writer after a prior read', async () => {
    // Role provisioning drains a take-once stash. The memoised reader hooksAfter
    // builds must hand the same claims to the attribute writer.
    let taken = false
    const stash = { department: 'Engineering' }
    let cached: Promise<Record<string, unknown>> | undefined
    const readClaims = () => {
      if (!cached) {
        cached = Promise.resolve(
          (() => {
            if (taken) return {}
            taken = true
            return stash
          })()
        )
      }
      return cached
    }
    await readClaims() // auto-provision reads first
    await applyClaimAttributesAfter(ctxFor(), providersWith(), new Set(['sso']), readClaims)
    expect(mockUpdateSet).toHaveBeenCalledWith({
      metadata: JSON.stringify({ department: 'Engineering' }),
    })
  })
})
