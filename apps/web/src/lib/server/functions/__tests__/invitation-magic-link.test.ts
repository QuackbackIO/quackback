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
    magicLinkToken: 'invitation.magicLinkToken',
  },
  eq: vi.fn((col: unknown, val: unknown) => ({ op: 'eq', col, val })),
  and: vi.fn((...parts: unknown[]) => ({ op: 'and', parts })),
  isNull: vi.fn((col: unknown) => ({ op: 'isNull', col })),
}))

const { generateInvitationMagicLink, rotateInviteMagicLinkToken } =
  await import('../invitation-magic-link')

beforeEach(() => {
  vi.clearAllMocks()
  mockMintMagicLinkUrl.mockResolvedValue({
    url: 'https://acme.test/verify-magic-link?token=abc',
    token: 'tok_team',
  })
  mockRevokeMagicLinkToken.mockResolvedValue(undefined)
  // Default: the compare-and-swap matched one row.
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

describe('rotateInviteMagicLinkToken', () => {
  it('revokes the prior token and records the new one when the invite still matches', async () => {
    mockReturning.mockResolvedValue([{ id: 'invite_1' }]) // CAS matched

    await rotateInviteMagicLinkToken('invite_1' as InviteId, 'tok_old', 'tok_new')

    expect(mockRevokeMagicLinkToken).toHaveBeenCalledTimes(1)
    expect(mockRevokeMagicLinkToken).toHaveBeenCalledWith('tok_old')
    expect(mockSet).toHaveBeenCalledWith({ magicLinkToken: 'tok_new' })
  })

  it('revokes the just-minted token and throws when the row changed (cancel / double-rotation race)', async () => {
    mockReturning.mockResolvedValue([]) // CAS matched nothing — row canceled or re-rotated

    await expect(
      rotateInviteMagicLinkToken('invite_1' as InviteId, 'tok_old', 'tok_new')
    ).rejects.toThrow(/changed during update/)

    // Prior token revoked, AND the orphan we just minted is cleaned up.
    expect(mockRevokeMagicLinkToken).toHaveBeenCalledWith('tok_old')
    expect(mockRevokeMagicLinkToken).toHaveBeenCalledWith('tok_new')
  })
})
