/**
 * removeTeamMemberFn hands the service the caller's role, so only an admin
 * can remove an admin (the service fails closed without it).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  removeTeamMember: vi.fn(),
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
vi.mock('@/lib/server/domains/principals/principal.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/principals/principal.service')>()),
  removeTeamMember: (...args: unknown[]) => hoisted.removeTeamMember(...args),
}))

const { removeTeamMemberFn } = await import('../admin')

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({
    user: { id: 'user_me', name: 'Me', email: 'me@example.com' },
    principal: { id: 'principal_me', role: 'member', type: 'user' },
    settings: { name: 'Acme', logoKey: null },
    permissions: ['member.manage'],
  })
  hoisted.removeTeamMember.mockResolvedValue(undefined)
})

describe('removeTeamMemberFn', () => {
  it("passes the caller's role for the admin ceiling", async () => {
    await removeTeamMemberFn({ data: { principalId: 'principal_t' } })
    const [principalId, acting, , , opts] = hoisted.removeTeamMember.mock.calls[0]
    expect([principalId, acting]).toEqual(['principal_t', 'principal_me'])
    expect(opts).toEqual({ granterRole: 'member' })
  })
})
