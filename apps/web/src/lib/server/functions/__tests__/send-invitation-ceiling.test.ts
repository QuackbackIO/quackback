/**
 * The admin grant ceiling on team invites: only an admin invites someone as
 * Admin, and a placeholder address is never invited.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  enforceSeatLimit: vi.fn(),
  generateInvitationMagicLink: vi.fn(),
  sendInvitationEmail: vi.fn(),
  getEmailSafeUrl: vi.fn(),
  sealedRecipient: vi.fn(),
  invitationFindFirst: vi.fn(),
  userFindFirst: vi.fn(),
  principalFindFirst: vi.fn(),
  insertValues: vi.fn(),
  transaction: vi.fn(),
  insert: vi.fn(),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain: Record<string, unknown> = {}
    chain.validator = () => chain
    chain.handler = (handler: (args: { data?: unknown }) => Promise<unknown>) =>
      Object.assign((args?: { data?: unknown }) => handler(args ?? {}), chain)
    return chain
  },
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => hoisted.requireAuth(...args),
}))

vi.mock('@/lib/server/domains/principals/seat-limit', () => ({
  enforceSeatLimit: (...args: unknown[]) => hoisted.enforceSeatLimit(...args),
}))

vi.mock('@/lib/server/functions/invitation-magic-link', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/invitation-magic-link')>()),
  generateInvitationMagicLink: (...args: unknown[]) => hoisted.generateInvitationMagicLink(...args),
}))

vi.mock('@quackback/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@quackback/email')>()),
  sendInvitationEmail: (...args: unknown[]) => hoisted.sendInvitationEmail(...args),
}))

vi.mock('@/lib/server/storage/s3', () => ({
  getEmailSafeUrl: (...args: unknown[]) => hoisted.getEmailSafeUrl(...args),
}))

vi.mock('@/lib/server/email/recipient', () => ({
  sealedRecipient: (...args: unknown[]) => hoisted.sealedRecipient(...args),
}))

vi.mock('@/lib/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/db')>()
  return {
    ...actual,
    db: {
      query: {
        invitation: { findFirst: (...args: unknown[]) => hoisted.invitationFindFirst(...args) },
        user: { findFirst: (...args: unknown[]) => hoisted.userFindFirst(...args) },
        principal: { findFirst: (...args: unknown[]) => hoisted.principalFindFirst(...args) },
      },
      transaction: (...args: unknown[]) => hoisted.transaction(...args),
      insert: (...args: unknown[]) => hoisted.insert(...args),
    },
  }
})

const { sendInvitationFn } = await import('../admin')

describe('sendInvitationFn grant ceiling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.invitationFindFirst.mockResolvedValue(undefined)
    hoisted.userFindFirst.mockResolvedValue(undefined)
    hoisted.generateInvitationMagicLink.mockResolvedValue({
      url: 'https://acme.test/invite',
      token: 'tok_1',
      sealedAddress: 'new@acme.test',
    })
    hoisted.sendInvitationEmail.mockResolvedValue({ sent: true })
    hoisted.getEmailSafeUrl.mockReturnValue(null)
    hoisted.sealedRecipient.mockReturnValue('new@acme.test')
    hoisted.insertValues.mockResolvedValue(undefined)
    hoisted.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        insert: () => ({ values: (...args: unknown[]) => hoisted.insertValues(...args) }),
      }
      return fn(tx)
    })
  })

  function authAs(role: 'admin' | 'member') {
    hoisted.requireAuth.mockResolvedValue({
      user: { id: 'user_inviter', name: 'Inviter' },
      principal: { id: 'principal_inviter', role, type: 'user' },
      settings: { name: 'Acme', logoKey: null },
      permissions: ['member.manage', 'member.view'],
    })
  }

  it('refuses a non-admin inviting someone as Admin, before minting or writing anything', async () => {
    authAs('member')

    await expect(
      sendInvitationFn({ data: { email: 'new@acme.test', role: 'admin' } })
    ).rejects.toMatchObject({ code: 'GRANT_CEILING' })
    expect(hoisted.generateInvitationMagicLink).not.toHaveBeenCalled()
    expect(hoisted.insertValues).not.toHaveBeenCalled()
  })

  it('lets a non-admin invite a member', async () => {
    authAs('member')

    await sendInvitationFn({ data: { email: 'new@acme.test', role: 'member' } })
    expect(hoisted.insertValues).toHaveBeenCalledOnce()
    const inserted = hoisted.insertValues.mock.calls[0]?.[0] as { role: string }
    expect(inserted.role).toBe('member')
  })

  it('lets an admin invite an Admin', async () => {
    authAs('admin')

    await sendInvitationFn({ data: { email: 'new@acme.test', role: 'admin' } })
    expect(hoisted.insertValues).toHaveBeenCalledOnce()
  })

  it('never invites a minted placeholder address', async () => {
    authAs('admin')

    await expect(
      sendInvitationFn({
        data: { email: 'sso-steam-abc@anon.quackback.io', role: 'member' },
      })
    ).rejects.toMatchObject({ code: 'NOT_ELIGIBLE' })
    expect(hoisted.generateInvitationMagicLink).not.toHaveBeenCalled()
  })
})
