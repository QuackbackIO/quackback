/**
 * acceptInvitationFn — claim lives in one transaction with principal writes.
 * A failed accept must not write `pending` after a claim (the reopen bug).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

const handlers: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

const hoisted = vi.hoisted(() => ({
  getSession: vi.fn(),
  findInvitation: vi.fn(),
  findPrincipal: vi.fn(),
  invitationReturning: vi.fn(),
  insertValues: vi.fn(),
  sets: [] as Array<{ table: string; values: Record<string, unknown> }>,
  revokeMagicLinkTokens: vi.fn(),
  generateId: vi.fn(() => 'principal_new'),
}))

vi.mock('@/lib/server/auth/session', () => ({
  getSession: hoisted.getSession,
}))

vi.mock('@/lib/server/auth/magic-link-mint', () => ({
  revokeMagicLinkTokens: hoisted.revokeMagicLinkTokens,
}))

vi.mock('@quackback/ids', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@quackback/ids')>()
  return { ...actual, generateId: hoisted.generateId }
})

vi.mock('@/lib/server/storage/s3', () => ({
  getPublicUrlOrNull: vi.fn(),
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() }) },
}))

vi.mock('@/lib/server/db', () => {
  const invitation = {
    id: 'invitation.id',
    status: 'invitation.status',
    kind: 'invitation.kind',
    email: 'invitation.email',
    expiresAt: 'invitation.expiresAt',
    $inferSelect: {},
  }
  const principal = { id: 'principal.id', userId: 'principal.userId' }
  const user = { id: 'user.id' }

  const tx = {
    query: {
      invitation: { findFirst: (...args: unknown[]) => hoisted.findInvitation(...args) },
      principal: { findFirst: (...args: unknown[]) => hoisted.findPrincipal(...args) },
    },
    update: (table: { id?: string }) => ({
      set: (values: Record<string, unknown>) => {
        const name =
          table === invitation ? 'invitation' : table === principal ? 'principal' : 'user'
        hoisted.sets.push({ table: name, values })
        return {
          where: () => ({
            returning: () =>
              name === 'invitation' ? hoisted.invitationReturning() : Promise.resolve([]),
          }),
        }
      },
    }),
    insert: () => ({
      values: (values: unknown) => hoisted.insertValues(values),
    }),
  }

  return {
    db: {
      transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
      query: tx.query,
    },
    invitation,
    principal,
    user,
    eq: vi.fn((col, val) => ({ col, val })),
    and: vi.fn((...args: unknown[]) => args),
    gt: vi.fn((col, val) => ({ col, val })),
    sql: vi.fn((parts: TemplateStringsArray) => parts.raw[0]),
  }
})

const ACCEPT_IDX = 1
const FUTURE = new Date(Date.now() + 86_400_000)
const PAST = new Date(Date.now() - 1000)
const INVITE_ID = 'invite_team1'
const SESSION = { user: { id: 'user_1', email: 'Alex@Example.com' } }

const CLAIMED = {
  id: INVITE_ID,
  email: 'alex@example.com',
  kind: 'team',
  status: 'accepted',
  role: 'member',
  expiresAt: FUTURE,
  magicLinkTokens: ['tok_1'],
}

let accept: AnyHandler

beforeEach(async () => {
  vi.clearAllMocks()
  hoisted.sets.length = 0
  hoisted.generateId.mockReturnValue('principal_new')
  hoisted.revokeMagicLinkTokens.mockResolvedValue(undefined)
  hoisted.getSession.mockResolvedValue(SESSION)
  hoisted.findPrincipal.mockResolvedValue(null)
  hoisted.insertValues.mockResolvedValue(undefined)
  hoisted.invitationReturning.mockResolvedValue([CLAIMED])

  if (handlers.length === 0) {
    await import('../invitations')
  }
  accept = handlers[ACCEPT_IDX]
})

describe('acceptInvitationFn', () => {
  it('claims a pending team invite and does not write pending afterwards', async () => {
    const result = await accept({ data: { invitationId: INVITE_ID } })

    expect(result).toEqual({ invitationId: INVITE_ID })
    expect(hoisted.sets.filter((s) => s.table === 'invitation')).toEqual([
      { table: 'invitation', values: { status: 'accepted' } },
    ])
    expect(hoisted.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user_1', role: 'member' })
    )
    expect(hoisted.revokeMagicLinkTokens).toHaveBeenCalledWith(['tok_1'])
  })

  it('does not reopen an already-accepted invite', async () => {
    hoisted.invitationReturning.mockResolvedValue([])
    hoisted.findInvitation.mockResolvedValue({
      ...CLAIMED,
      status: 'accepted',
    })

    await expect(accept({ data: { invitationId: INVITE_ID } })).rejects.toThrow(
      'already been accepted'
    )
    expect(hoisted.sets.some((s) => s.values.status === 'pending')).toBe(false)
    expect(hoisted.insertValues).not.toHaveBeenCalled()
    expect(hoisted.revokeMagicLinkTokens).not.toHaveBeenCalled()
  })

  it('leaves the row untouched on email mismatch', async () => {
    hoisted.invitationReturning.mockResolvedValue([])
    hoisted.findInvitation.mockResolvedValue({
      id: INVITE_ID,
      email: 'other@example.com',
      kind: 'team',
      status: 'pending',
      expiresAt: FUTURE,
    })

    await expect(accept({ data: { invitationId: INVITE_ID } })).rejects.toThrow(
      'different email address'
    )
    expect(hoisted.sets.some((s) => s.values.status === 'pending')).toBe(false)
  })

  it('leaves the row untouched when the invite is expired', async () => {
    hoisted.invitationReturning.mockResolvedValue([])
    hoisted.findInvitation.mockResolvedValue({
      id: INVITE_ID,
      email: 'alex@example.com',
      kind: 'team',
      status: 'pending',
      expiresAt: PAST,
    })

    await expect(accept({ data: { invitationId: INVITE_ID } })).rejects.toThrow('expired')
    expect(hoisted.sets.some((s) => s.values.status === 'pending')).toBe(false)
  })

  it('does not reopen the invite when a principal write fails after claim', async () => {
    hoisted.insertValues.mockRejectedValue(new Error('unique violation'))

    await expect(accept({ data: { invitationId: INVITE_ID } })).rejects.toThrow('unique violation')
    expect(hoisted.sets.filter((s) => s.table === 'invitation')).toEqual([
      { table: 'invitation', values: { status: 'accepted' } },
    ])
    expect(hoisted.sets.some((s) => s.values.status === 'pending')).toBe(false)
    expect(hoisted.revokeMagicLinkTokens).not.toHaveBeenCalled()
  })
})
