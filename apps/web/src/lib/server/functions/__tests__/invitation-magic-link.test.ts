import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockMintMagicLinkUrl = vi.fn()

vi.mock('@/lib/server/auth/magic-link-mint', () => ({
  mintMagicLinkUrl: mockMintMagicLinkUrl,
}))

const { generateInvitationMagicLink } = await import('../invitation-magic-link')

beforeEach(() => {
  vi.clearAllMocks()
  mockMintMagicLinkUrl.mockResolvedValue({
    url: 'https://acme.test/verify-magic-link?token=abc',
    token: 'tok_team',
  })
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
