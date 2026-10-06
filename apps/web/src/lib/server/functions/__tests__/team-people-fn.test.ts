/**
 * addTeamMembersFn returns expected refusals as values. A typed error thrown
 * from a server function does not reliably reach the client with its code, so
 * the function converts the service's domain refusals into
 * `{ ok: false, code, message, ... }` and lets anything else throw.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import {
  ADD_REFUSAL_CODES,
  CHANGE_ROLE_REFUSAL_CODES,
  TEAM_INVITATION_VALID_DAYS,
} from '@/lib/shared/team-people'
import { INVITATION_EXPIRY_MS } from '../invitation-magic-link'

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  addTeamMembers: vi.fn(),
  updateMemberRole: vi.fn(),
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

vi.mock('@/lib/server/domains/principals/principal.service', () => ({
  updateMemberRole: (...args: unknown[]) => hoisted.updateMemberRole(...args),
}))

const { addTeamMembersFn, changeTeamRoleFn } = await import('../team-people')
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

describe('changeTeamRoleFn', () => {
  const data = { principalId: 'principal_t', role: 'member' as const, roleId: 'role_x' }

  it("passes the caller's role and permissions as the ceiling and returns the new role", async () => {
    hoisted.updateMemberRole.mockResolvedValue({
      role: 'member',
      roleId: 'role_x',
      roleName: 'Support lead',
    })
    expect(await changeTeamRoleFn({ data })).toEqual({
      ok: true,
      role: 'member',
      roleId: 'role_x',
      roleName: 'Support lead',
    })
    const [principalId, role, acting, actor, , opts] = hoisted.updateMemberRole.mock.calls[0]
    expect([principalId, role, acting]).toEqual(['principal_t', 'member', 'principal_me'])
    expect(actor).toMatchObject({ userId: 'user_me', role: 'admin' })
    expect(opts).toEqual({
      assignRoleId: 'role_x',
      granterPermissions: ['member.manage'],
      granterRole: 'admin',
    })
  })

  it.each([
    [new ForbiddenError('GRANT_CEILING', 'Only an admin can change an admin'), 'GRANT_CEILING'],
    [new ForbiddenError('LAST_ADMIN', 'Cannot demote the last admin'), 'LAST_ADMIN'],
    [
      new ForbiddenError('CANNOT_MODIFY_SELF', 'You cannot change your own role'),
      'CANNOT_MODIFY_SELF',
    ],
    [new SeatLimitError({ needed: 1, free: 0, used: 3, max: 3 }), 'SEAT_LIMIT'],
    [new ValidationError('NOT_ELIGIBLE', 'has not signed in'), 'NOT_ELIGIBLE'],
    [new NotFoundError('MEMBER_NOT_FOUND', 'Team member not found'), 'NOT_FOUND'],
  ])('returns %s as a refusal', async (error, code) => {
    hoisted.updateMemberRole.mockRejectedValue(error)
    expect(await changeTeamRoleFn({ data })).toEqual({ ok: false, code, message: error.message })
  })

  it('still throws anything unexpected', async () => {
    hoisted.updateMemberRole.mockRejectedValue(new Error('database down'))
    await expect(changeTeamRoleFn({ data })).rejects.toThrow('database down')
  })
})

describe('shared team-people constants', () => {
  it('lists every refusal code the functions return', () => {
    expect([...ADD_REFUSAL_CODES].sort()).toEqual(
      [
        'ALREADY_MEMBER',
        'GRANT_CEILING',
        'INVITE_PENDING',
        'NOT_ELIGIBLE',
        'SEAT_LIMIT',
        'VALIDATION_ERROR',
      ].sort()
    )
    expect([...CHANGE_ROLE_REFUSAL_CODES].sort()).toEqual(
      [
        'CANNOT_MODIFY_SELF',
        'GRANT_CEILING',
        'LAST_ADMIN',
        'NOT_ELIGIBLE',
        'NOT_FOUND',
        'SEAT_LIMIT',
      ].sort()
    )
  })

  it('derives the invitation lifetime from one number of days', () => {
    expect(TEAM_INVITATION_VALID_DAYS).toBe(30)
    expect(INVITATION_EXPIRY_MS).toBe(TEAM_INVITATION_VALID_DAYS * 24 * 60 * 60 * 1000)
  })
})
