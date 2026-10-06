/**
 * addTeamMembersFn returns expected refusals as values. A typed error thrown
 * from a server function does not reliably reach the client with its code, so
 * the function converts the service's domain refusals into
 * `{ ok: false, code, message, ... }` and lets anything else throw.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictError, ForbiddenError, ValidationError } from '@/lib/shared/errors'

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  addTeamMembers: vi.fn(),
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
vi.mock('@tanstack/react-start/server', () => ({ getRequestHeaders: () => new Headers() }))
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => hoisted.requireAuth(...args),
}))
vi.mock('@/lib/server/domains/principals/team-additions', () => ({
  addTeamMembers: (...args: unknown[]) => hoisted.addTeamMembers(...args),
}))

const { addTeamMembersFn } = await import('../team-people')
const { SeatLimitError } = await import('@/lib/server/domains/principals/seat-limit')

const input = { principalIds: ['principal_a'], emails: ['x@example.com'], role: 'member' as const }

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({
    user: { id: 'user_me', name: 'Me', email: 'me@example.com' },
    principal: { id: 'principal_me', role: 'admin', type: 'user' },
    settings: { name: 'Acme', logoKey: null },
    permissions: ['member.manage'],
  })
})

describe('addTeamMembersFn', () => {
  it('returns ok with the added and invited people', async () => {
    hoisted.addTeamMembers.mockResolvedValue({
      added: [{ principalId: 'principal_a', name: 'A' }],
      invited: [],
    })
    expect(await addTeamMembersFn({ data: input })).toEqual({
      ok: true,
      added: [{ principalId: 'principal_a', name: 'A' }],
      invited: [],
    })
  })

  it('returns a seat refusal with the needed and free counts', async () => {
    hoisted.addTeamMembers.mockRejectedValue(
      new SeatLimitError({ needed: 2, free: 1, used: 9, max: 10 })
    )
    expect(await addTeamMembersFn({ data: input })).toEqual({
      ok: false,
      code: 'SEAT_LIMIT',
      message: expect.stringMatching(/needs 2 and 1 is free/),
      needed: 2,
      free: 1,
    })
  })

  it.each([
    [new ForbiddenError('GRANT_CEILING', 'Only an admin can grant the Admin role'), {}],
    [
      Object.assign(new ConflictError('ALREADY_MEMBER', 'x@example.com is already on the team'), {
        email: 'x@example.com',
      }),
      { email: 'x@example.com' },
    ],
    [
      Object.assign(new ConflictError('INVITE_PENDING', 'pending'), { email: 'x@example.com' }),
      { email: 'x@example.com' },
    ],
    [
      Object.assign(new ValidationError('NOT_ELIGIBLE', 'A has not signed in'), {
        principalId: 'principal_a',
      }),
      { principalId: 'principal_a' },
    ],
    [new ValidationError('VALIDATION_ERROR', 'listed twice'), {}],
  ])('returns %s as a refusal naming the item', async (error, item) => {
    hoisted.addTeamMembers.mockRejectedValue(error)
    expect(await addTeamMembersFn({ data: input })).toEqual({
      ok: false,
      code: error.code,
      message: error.message,
      ...item,
    })
  })

  it('still throws anything that is not an expected refusal', async () => {
    hoisted.addTeamMembers.mockRejectedValue(new Error('database down'))
    await expect(addTeamMembersFn({ data: input })).rejects.toThrow('database down')
  })
})
