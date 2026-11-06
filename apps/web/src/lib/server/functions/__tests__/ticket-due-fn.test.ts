/**
 * The due-date server fns. setTicketDueAtFn is the inbox's due-date write. Gated on ticket.set_status
 * (like priority), it turns the wire ISO instant into a Date, passes an
 * explicit null through as a clear, and rejects a malformed or date-only value
 * before auth or the service. runCreateMyTicket (portal + widget) hands the
 * customer's proposed date to the requester service as a Date. createServerFn is stubbed to a directly-callable
 * fn (mirrors ticket-create-validation.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => {
    let _schema: { parse: (v: unknown) => unknown } | null = null
    let _handler: ((args: { data: unknown }) => Promise<unknown>) | null = null
    const fn = async (args?: { data: unknown }) => {
      if (!_handler) throw new Error('handler not registered')
      return _handler({ data: _schema ? _schema.parse(args?.data) : args?.data })
    }
    fn.validator = (schema: { parse: (v: unknown) => unknown }) => {
      _schema = schema
      return fn
    }
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
  setTicketDueAt: vi.fn(),
  createMyTicket: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
  policyActorFromAuth: hoisted.policyActorFromAuth,
}))
vi.mock('@/lib/server/domains/tickets/ticket-due.service', () => ({
  setTicketDueAt: hoisted.setTicketDueAt,
}))

vi.mock('@/lib/server/domains/settings/settings.support', () => ({
  isSupportTicketsEnabled: async () => true,
}))
vi.mock('@/lib/server/domains/tickets/ticket-type-intake.service', () => ({
  resolveIntakeCreate: async () => ({ ticketTypeId: null, customAttributes: undefined }),
}))
vi.mock('@/lib/server/domains/tickets/requester.service', () => ({
  createMyTicket: hoisted.createMyTicket,
}))

import { setTicketDueAtFn, runCreateMyTicket } from '../tickets'

const TICKET_ID = 'ticket_01h455vb4pex5vsknk084sn02q'
const actor = { type: 'user', principalId: 'principal_admin' }

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_admin' } })
  hoisted.policyActorFromAuth.mockResolvedValue(actor)
  hoisted.setTicketDueAt.mockResolvedValue({ id: TICKET_ID })
})

describe('setTicketDueAtFn', () => {
  it('gates on ticket.set_status and passes the resolved actor', async () => {
    await setTicketDueAtFn({ data: { ticketId: TICKET_ID, dueAt: '2026-11-03T17:00:00Z' } })
    expect(hoisted.requireAuth).toHaveBeenCalledWith({
      permission: PERMISSIONS.TICKET_SET_STATUS,
    })
    expect(hoisted.setTicketDueAt.mock.calls[0][2]).toBe(actor)
  })

  it('turns the ISO instant into a Date, honoring its offset', async () => {
    const out = await setTicketDueAtFn({
      data: { ticketId: TICKET_ID, dueAt: '2026-11-03T09:00:00-08:00' },
    })
    const [id, dueAt] = hoisted.setTicketDueAt.mock.calls[0]
    expect(id).toBe(TICKET_ID)
    expect(dueAt).toBeInstanceOf(Date)
    expect(dueAt.toISOString()).toBe('2026-11-03T17:00:00.000Z')
    expect(out).toEqual({ id: TICKET_ID })
  })

  it('passes an explicit null through as a clear', async () => {
    await setTicketDueAtFn({ data: { ticketId: TICKET_ID, dueAt: null } })
    expect(hoisted.setTicketDueAt.mock.calls[0][1]).toBeNull()
  })

  it('rejects a missing, malformed or date-only dueAt before auth or the service', async () => {
    for (const data of [
      { ticketId: TICKET_ID },
      { ticketId: TICKET_ID, dueAt: '2026-11-03' },
      { ticketId: TICKET_ID, dueAt: 'tomorrow' },
      { ticketId: TICKET_ID, dueAt: 1_700_000_000_000 },
    ]) {
      await expect(setTicketDueAtFn({ data } as never)).rejects.toThrow()
    }
    expect(hoisted.requireAuth).not.toHaveBeenCalled()
    expect(hoisted.setTicketDueAt).not.toHaveBeenCalled()
  })

  it('surfaces the service rejection (e.g. an out-of-window date)', async () => {
    hoisted.setTicketDueAt.mockRejectedValue(new Error('Due date is too far in the future'))
    await expect(
      setTicketDueAtFn({ data: { ticketId: TICKET_ID, dueAt: '2099-01-01T00:00:00Z' } })
    ).rejects.toThrow(/too far in the future/)
  })
})

describe('runCreateMyTicket due date', () => {
  const ctx = { principal: { id: 'principal_requester' } } as never

  it("hands the customer's proposed date to the requester service as a Date", async () => {
    await runCreateMyTicket(ctx, { title: 'Need it', dueAt: '2026-11-03T23:59:00-08:00' })
    const [passedActor, input] = hoisted.createMyTicket.mock.calls[0]
    expect(passedActor).toBe(actor)
    expect(input.dueAt).toBeInstanceOf(Date)
    expect(input.dueAt.toISOString()).toBe('2026-11-04T07:59:00.000Z')
  })

  it('leaves dueAt unset when the customer proposes none', async () => {
    await runCreateMyTicket(ctx, { title: 'No rush' })
    expect(hoisted.createMyTicket.mock.calls[0][1].dueAt).toBeUndefined()
  })
})
