/**
 * Tests for bulkUpdateTicketsFn (support platform §4.6 bulk actions, ticket
 * axis) — mirrors conversation-bulk.test.ts's coverage.
 *
 * Unlike the conversation fn (which loops the single-conversation service ops
 * itself), the ticket fn is thin: it gates on a bare requireAuth + an
 * action-dependent permission check, resolves the actor and 'me'/team-id
 * input shaping, then delegates the whole per-item loop to the domain-level
 * `bulkUpdateTickets` (ticket.service.ts) — so these tests assert the fn's
 * seam (permission gating + input resolution + delegation with the right
 * args), not the per-item isolation itself (that's covered where it lives:
 * ticket.service.test.ts's own `bulkUpdateTickets` describe block).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { permissionsForLegacyRole } from '@/lib/server/policy/permissions'
import type { Role } from '@/lib/server/auth'
import type { PermissionKey } from '@/lib/server/db'

// createServerFn → directly-callable fns (mirrors conversation-bulk.test.ts).
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let _handler: ((args: { data: unknown }) => Promise<unknown>) | null = null
    const fn = (args: { data: unknown }) => {
      if (!_handler) throw new Error('handler not registered')
      return _handler(args)
    }
    fn.validator = () => fn
    fn.handler = (h: (args: { data: unknown }) => Promise<unknown>) => {
      _handler = h
      return fn
    }
    return fn
  },
}))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  policyActorFromAuth: vi.fn(),
  bulkUpdateTickets: vi.fn(),
  log: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}))

vi.mock('@/lib/server/logger', () => {
  const child = () => ({ ...hoisted.log, child })
  return { logger: { ...hoisted.log, child }, createLogger: () => ({ ...hoisted.log, child }) }
})

vi.mock('@/lib/server/functions/auth-helpers', async () => {
  // Exercise the REAL per-role permission check so the action-dependent gate is
  // meaningfully asserted (the policy module is not mocked); mirrors the
  // conversation bulk fn's test.
  const { permissionsForLegacyRole } = await import('@/lib/server/policy/permissions')
  return {
    requireAuth: hoisted.requireAuth,
    policyActorFromAuth: hoisted.policyActorFromAuth,
    assertPermission: (
      auth: { permissions?: PermissionKey[]; principal: { role: Role } },
      permission: PermissionKey
    ) => {
      const held = auth.permissions ?? [...permissionsForLegacyRole(auth.principal.role)]
      if (!held.includes(permission)) {
        throw new Error(
          `Access denied: Requires permission '${permission}', role ${auth.principal.role} lacks it`
        )
      }
    },
  }
})

vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  bulkUpdateTickets: hoisted.bulkUpdateTickets,
}))

import { bulkUpdateTicketsFn } from '../tickets'

const AUTH = {
  user: { id: 'user_agent1', email: 'agent@x', name: 'Agent', image: null },
  principal: { id: 'principal_agent1', role: 'admin' as const, type: 'user' },
  settings: { id: 'ws_1', slug: 'x', name: 'X', logoKey: null },
}
// Opaque actor object — bulkUpdateTickets is mocked, so only identity matters.
const ACTOR = { principalId: 'principal_agent1' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (data: any) => bulkUpdateTicketsFn({ data })

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue(AUTH)
  hoisted.policyActorFromAuth.mockResolvedValue(ACTOR)
  hoisted.bulkUpdateTickets.mockResolvedValue({ succeeded: [], failed: [] })
})

describe('bulkUpdateTicketsFn — gating', () => {
  it('propagates a requireAuth rejection and never delegates', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(
      call({ ticketIds: ['ticket_t1'], action: { type: 'priority', priority: 'high' } })
    ).rejects.toThrow('Access denied')
    expect(hoisted.bulkUpdateTickets).not.toHaveBeenCalled()
  })

  it('authenticates with a bare requireAuth (permission is action-dependent)', async () => {
    await call({ ticketIds: ['ticket_t1'], action: { type: 'priority', priority: 'high' } })
    expect(hoisted.requireAuth).toHaveBeenCalledWith()
  })

  it('rejects assign/assign_team actions when the role lacks ticket.assign', async () => {
    // 'member' holds set_status but not assign (assign is Manager+), mirroring
    // the conversation fn's split.
    const assignable = permissionsForLegacyRole('member')
    const skip = assignable.has(PERMISSIONS.TICKET_ASSIGN)
    hoisted.requireAuth.mockResolvedValue({
      ...AUTH,
      principal: { ...AUTH.principal, role: 'member' as const },
    })
    for (const action of [
      { type: 'assign' as const, assignTo: null },
      { type: 'assign_team' as const, teamId: null },
    ]) {
      if (skip) continue
      await expect(call({ ticketIds: ['ticket_t1'], action })).rejects.toThrow(/ticket\.assign/)
    }
    expect(hoisted.bulkUpdateTickets).not.toHaveBeenCalled()
  })

  it('allows priority/set_status actions for a role that holds ticket.set_status', async () => {
    hoisted.bulkUpdateTickets.mockResolvedValue({ succeeded: ['ticket_t1'], failed: [] })
    for (const action of [
      { type: 'priority' as const, priority: 'high' as const },
      { type: 'set_status' as const, statusId: 'ticket_status_1' },
    ]) {
      const res = await call({ ticketIds: ['ticket_t1'], action })
      expect(res.succeeded).toEqual(['ticket_t1'])
    }
  })
})

describe('bulkUpdateTicketsFn — action routing + delegation', () => {
  it("resolves assign 'me' to the acting agent principal", async () => {
    await call({ ticketIds: ['ticket_t1'], action: { type: 'assign', assignTo: 'me' } })
    expect(hoisted.bulkUpdateTickets).toHaveBeenCalledWith(
      ['ticket_t1'],
      { type: 'assign', assignTo: 'principal_agent1' },
      ACTOR
    )
  })

  it('passes a null assignee through as an unassign', async () => {
    await call({ ticketIds: ['ticket_t1'], action: { type: 'assign', assignTo: null } })
    expect(hoisted.bulkUpdateTickets).toHaveBeenCalledWith(
      ['ticket_t1'],
      { type: 'assign', assignTo: null },
      ACTOR
    )
  })

  it('passes a specific assignee principal id through unchanged', async () => {
    await call({
      ticketIds: ['ticket_t1'],
      action: { type: 'assign', assignTo: 'principal_other' },
    })
    expect(hoisted.bulkUpdateTickets).toHaveBeenCalledWith(
      ['ticket_t1'],
      { type: 'assign', assignTo: 'principal_other' },
      ACTOR
    )
  })

  it('routes assign_team through with the team id', async () => {
    await call({ ticketIds: ['ticket_t1'], action: { type: 'assign_team', teamId: 'team_1' } })
    expect(hoisted.bulkUpdateTickets).toHaveBeenCalledWith(
      ['ticket_t1'],
      { type: 'assign_team', teamId: 'team_1' },
      ACTOR
    )
  })

  it('routes a null team id through as a team-unassign', async () => {
    await call({ ticketIds: ['ticket_t1'], action: { type: 'assign_team', teamId: null } })
    expect(hoisted.bulkUpdateTickets).toHaveBeenCalledWith(
      ['ticket_t1'],
      { type: 'assign_team', teamId: null },
      ACTOR
    )
  })

  it('routes priority through unchanged', async () => {
    await call({ ticketIds: ['ticket_t1'], action: { type: 'priority', priority: 'urgent' } })
    expect(hoisted.bulkUpdateTickets).toHaveBeenCalledWith(
      ['ticket_t1'],
      { type: 'priority', priority: 'urgent' },
      ACTOR
    )
  })

  it('routes set_status through with the status id', async () => {
    await call({
      ticketIds: ['ticket_t1'],
      action: { type: 'set_status', statusId: 'ticket_status_9' },
    })
    expect(hoisted.bulkUpdateTickets).toHaveBeenCalledWith(
      ['ticket_t1'],
      { type: 'set_status', statusId: 'ticket_status_9' },
      ACTOR
    )
  })

  it('passes multiple ticket ids through as given', async () => {
    await call({
      ticketIds: ['ticket_t1', 'ticket_t2', 'ticket_t3'],
      action: { type: 'priority', priority: 'low' },
    })
    expect(hoisted.bulkUpdateTickets).toHaveBeenCalledWith(
      ['ticket_t1', 'ticket_t2', 'ticket_t3'],
      { type: 'priority', priority: 'low' },
      ACTOR
    )
  })

  it('returns the delegated succeeded/failed summary unchanged', async () => {
    hoisted.bulkUpdateTickets.mockResolvedValue({
      succeeded: ['ticket_t1'],
      failed: [{ id: 'ticket_t2', reason: 'boom' }],
    })
    const result = await call({
      ticketIds: ['ticket_t1', 'ticket_t2'],
      action: { type: 'priority', priority: 'high' },
    })
    expect(result).toEqual({
      succeeded: ['ticket_t1'],
      failed: [{ id: 'ticket_t2', reason: 'boom' }],
    })
  })
})
