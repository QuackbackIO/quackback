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

describe('sendInvitationFn seat reservation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.requireAuth.mockResolvedValue({
      user: { id: 'user_inviter', name: 'Inviter' },
      settings: { name: 'Acme', logoKey: null },
      permissions: [],
    })
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

  it('runs enforceSeatLimit and the invite insert on the same transaction', async () => {
    await sendInvitationFn({
      data: { email: 'new@acme.test', role: 'member' },
    })

    expect(hoisted.transaction).toHaveBeenCalledOnce()
    expect(hoisted.enforceSeatLimit).toHaveBeenCalledOnce()
    const seatArgs = hoisted.enforceSeatLimit.mock.calls[0]?.[0] as { executor: unknown }
    expect(seatArgs.executor).toBeDefined()
    expect(hoisted.insertValues).toHaveBeenCalledOnce()
    expect(hoisted.insert).not.toHaveBeenCalled()
    const inserted = hoisted.insertValues.mock.calls[0]?.[0] as { email: string; status: string }
    expect(inserted.email).toBe('new@acme.test')
    expect(inserted.status).toBe('pending')
  })
})
