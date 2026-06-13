import type { InviteId } from '@quackback/ids'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockMintMagicLinkUrl = vi.fn()
const mockRevokeMagicLinkToken = vi.fn()

vi.mock('@/lib/server/auth/magic-link-mint', () => ({
  mintMagicLinkUrl: mockMintMagicLinkUrl,
  revokeMagicLinkToken: mockRevokeMagicLinkToken,
}))

// Minimal db update-chain mock for rotateInviteMagicLinkToken's compare-and-swap.
const mockReturning = vi.fn()
const mockWhere = vi.fn(() => ({ returning: mockReturning }))
const mockSet = vi.fn(() => ({ where: mockWhere }))
const mockUpdate = vi.fn(() => ({ set: mockSet }))

vi.mock('@/lib/server/db', () => ({
  db: { update: mockUpdate },
  invitation: {
    id: 'invitation.id',
    status: 'invitation.status',
    magicLinkTokens: 'invitation.magicLinkTokens',
  },
  eq: vi.fn((col: unknown, val: unknown) => ({ op: 'eq', col, val })),
  and: vi.fn((...parts: unknown[]) => ({ op: 'and', parts })),
  sql: vi.fn((parts: TemplateStringsArray) => ({ op: 'sql', raw: parts.raw[0] })),
}))

const { generateInvitationMagicLink, appendInviteMagicLinkToken, removeInviteMagicLinkToken } =
  await import('../invitation-magic-link')

beforeEach(() => {
  vi.clearAllMocks()
  mockMintMagicLinkUrl.mockResolvedValue({
    url: 'https://acme.test/verify-magic-link?token=abc',
    token: 'tok_team',
  })
  mockRevokeMagicLinkToken.mockResolvedValue(undefined)
  // Default: the status-pinned append matched one row.
  mockReturning.mockResolvedValue([{ id: 'invite_1' }])
})

describe('generateInvitationMagicLink', () => {
  it('mints a link that lives as long as the invitation record (30 days), not the 10-minute sign-in default', async () => {
    await generateInvitationMagicLink(
      'invitee@example.com',
      '/complete-signup/invite_1',
      'https://acme.test'
    )

    expect(mockMintMagicLinkUrl).toHaveBeenCalledTimes(1)
    expect(mockMintMagicLinkUrl.mock.calls[0][0]).toMatchObject({
      email: 'invitee@example.com',
      callbackPath: '/complete-signup/invite_1',
      portalUrl: 'https://acme.test',
      expiresInSeconds: 30 * 24 * 60 * 60,
    })
  })

  it('returns the minted url and token so the caller can persist the token for revocation', async () => {
    const result = await generateInvitationMagicLink(
      'invitee@example.com',
      '/complete-signup/invite_1',
      'https://acme.test'
    )
    expect(result).toEqual({
      url: 'https://acme.test/verify-magic-link?token=abc',
      token: 'tok_team',
    })
  })
})

describe('appendInviteMagicLinkToken', () => {
  it('appends and returns true while the invite is pending', async () => {
    mockReturning.mockResolvedValue([{ id: 'invite_1' }]) // status-pinned UPDATE matched

    const ok = await appendInviteMagicLinkToken('invite_1' as InviteId, 'tok_new')

    expect(ok).toBe(true)
    expect(mockSet).toHaveBeenCalledTimes(1) // SET magic_link_tokens = array_append(...)
    // Appending is a pure add — revocation is the caller's responsibility.
    expect(mockRevokeMagicLinkToken).not.toHaveBeenCalled()
  })

  it('returns false without throwing when the invite is no longer pending', async () => {
    mockReturning.mockResolvedValue([]) // UPDATE matched nothing (canceled/accepted/expired)

    const ok = await appendInviteMagicLinkToken('invite_1' as InviteId, 'tok_new')

    expect(ok).toBe(false)
  })
})

describe('removeInviteMagicLinkToken', () => {
  it('drops the token from the set and revokes it', async () => {
    await removeInviteMagicLinkToken('invite_1' as InviteId, 'tok_x')

    expect(mockSet).toHaveBeenCalledTimes(1) // SET magic_link_tokens = array_remove(...)
    expect(mockRevokeMagicLinkToken).toHaveBeenCalledWith('tok_x')
  })
})
