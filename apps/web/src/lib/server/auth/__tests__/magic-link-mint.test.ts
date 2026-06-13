/**
 * `mintMagicLinkUrl` writes the verification row directly via
 * Better-Auth's internalAdapter, bypassing `auth.api.signInMagicLink`
 * (which fires our hooksBefore chain). This is essential so that the
 * server-initiated magic-link flows — team invitations, recovery-code
 * minting, password-reset — keep working even when the admin has
 * disabled team magic-link as a user-initiated sign-in method.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSignInMagicLink = vi.fn()
const mockCreateVerificationValue = vi.fn()

vi.mock('../index', async () => {
  return {
    getAuth: async () => ({
      api: { signInMagicLink: mockSignInMagicLink },
      $context: {
        internalAdapter: {
          createVerificationValue: mockCreateVerificationValue,
        },
      },
    }),
    getMagicLinkToken: () => null, // unused under the new path
  }
})

const mockDeleteWhere = vi.fn().mockResolvedValue(undefined)
const mockDbDelete = vi.fn(() => ({ where: mockDeleteWhere }))
const mockEq = vi.fn((col: unknown, val: unknown) => ({ col, val }))
const mockVerificationTable = {
  identifier: 'verification.identifier',
  expiresAt: 'verification.expiresAt',
}
// select().from().where().limit() chain for isMagicLinkTokenLive
const mockSelectLimit = vi.fn()
const mockDbSelect = vi.fn(() => ({
  from: () => ({ where: () => ({ limit: mockSelectLimit }) }),
}))

vi.mock('@/lib/server/db', () => ({
  db: { delete: mockDbDelete, select: mockDbSelect },
  verification: mockVerificationTable,
  eq: mockEq,
}))

const { mintMagicLinkUrl, revokeMagicLinkToken, isMagicLinkTokenLive } =
  await import('../magic-link-mint')

beforeEach(() => {
  vi.clearAllMocks()
  mockCreateVerificationValue.mockResolvedValue({ id: 'ver_1' })
})

describe('mintMagicLinkUrl', () => {
  it('does NOT call auth.api.signInMagicLink (which would fire hooksBefore)', async () => {
    await mintMagicLinkUrl({
      email: 'a@b.com',
      callbackPath: '/admin',
      portalUrl: 'https://acme.test',
    })
    expect(mockSignInMagicLink).not.toHaveBeenCalled()
  })

  it('writes a verification row via internalAdapter.createVerificationValue', async () => {
    await mintMagicLinkUrl({
      email: 'a@b.com',
      callbackPath: '/admin',
      portalUrl: 'https://acme.test',
    })
    expect(mockCreateVerificationValue).toHaveBeenCalledTimes(1)
    const args = mockCreateVerificationValue.mock.calls[0][0] as {
      identifier: string
      value: string
      expiresAt: Date
    }
    expect(typeof args.identifier).toBe('string')
    expect(args.identifier.length).toBeGreaterThan(16)
    const parsed = JSON.parse(args.value)
    expect(parsed.email).toBe('a@b.com')
    expect(args.expiresAt).toBeInstanceOf(Date)
  })

  it('honours expiresInSeconds override for long-lived invitations', async () => {
    const before = Date.now()
    await mintMagicLinkUrl({
      email: 'a@b.com',
      callbackPath: '/admin',
      portalUrl: 'https://acme.test',
      expiresInSeconds: 7 * 24 * 60 * 60,
    })
    const args = mockCreateVerificationValue.mock.calls[0][0] as { expiresAt: Date }
    const expectedMs = before + 7 * 24 * 60 * 60 * 1000
    expect(args.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMs - 5_000)
    expect(args.expiresAt.getTime()).toBeLessThanOrEqual(expectedMs + 5_000)
  })

  it('returns a /verify-magic-link URL with the token embedded', async () => {
    const { url, token } = await mintMagicLinkUrl({
      email: 'a@b.com',
      callbackPath: '/admin',
      portalUrl: 'https://acme.test',
    })
    expect(url).toMatch(/^https:\/\/acme\.test\/verify-magic-link\?token=/)
    expect(url).toContain('callbackURL=')
    // The returned token is the verification identifier and the one in the URL.
    expect(token).toBe(mockCreateVerificationValue.mock.calls[0][0].identifier)
    expect(url).toContain(`token=${token}`)
  })
})

describe('revokeMagicLinkToken', () => {
  it('deletes the verification row whose identifier is the token', async () => {
    await revokeMagicLinkToken('tok_abc')

    expect(mockDbDelete).toHaveBeenCalledTimes(1)
    expect(mockDbDelete).toHaveBeenCalledWith(mockVerificationTable)
    expect(mockEq).toHaveBeenCalledWith(mockVerificationTable.identifier, 'tok_abc')
    expect(mockDeleteWhere).toHaveBeenCalled()
  })

  it('is a no-op when the token is null (invite minted before tracking)', async () => {
    await revokeMagicLinkToken(null)
    expect(mockDbDelete).not.toHaveBeenCalled()
  })
})

describe('isMagicLinkTokenLive', () => {
  it('is true when the verification row exists and has not expired', async () => {
    mockSelectLimit.mockResolvedValue([{ expiresAt: new Date(Date.now() + 60_000) }])
    expect(await isMagicLinkTokenLive('tok_abc')).toBe(true)
  })

  it('is false when the row is missing (single-use token already consumed)', async () => {
    mockSelectLimit.mockResolvedValue([])
    expect(await isMagicLinkTokenLive('tok_abc')).toBe(false)
  })

  it('is false when the row exists but has expired', async () => {
    mockSelectLimit.mockResolvedValue([{ expiresAt: new Date(Date.now() - 60_000) }])
    expect(await isMagicLinkTokenLive('tok_abc')).toBe(false)
  })

  it('is false (no query) for a null token', async () => {
    expect(await isMagicLinkTokenLive(null)).toBe(false)
    expect(mockDbSelect).not.toHaveBeenCalled()
  })
})
