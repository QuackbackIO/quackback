/**
 * createTicketFn's Phase 4 field-schema validation as GATE 2 of the Phase 5
 * auto-fill contract (scratchpad/convergence-design.md): a poisoned or
 * hallucinated suggestion that reached the submit payload (an out-of-enum
 * select value, a malformed date) can never persist — the save path runs the
 * same `validateTicketIntakeValues` the suggestion service gated on, and
 * rejects before the ticket service is ever called. createServerFn is stubbed
 * to a directly-callable fn (mirrors copilot-summary.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createId, type TicketTypeId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'

vi.mock('@tanstack/react-start', () => ({
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
  getTicketType: vi.fn(),
  createTicket: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
  policyActorFromAuth: hoisted.policyActorFromAuth,
}))
vi.mock('@/lib/server/domains/tickets/ticket-type.service', () => ({
  getTicketType: hoisted.getTicketType,
}))
vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  createTicket: hoisted.createTicket,
}))

import { createTicketFn } from '../tickets'

const TICKET_TYPE_ID = createId('ticket_type') as TicketTypeId

const bugType = {
  id: TICKET_TYPE_ID,
  fields: [
    {
      key: 'severity',
      label: 'Severity',
      type: 'select',
      required: true,
      visibleToCustomer: true,
      order: 0,
      options: ['Low', 'High'],
    },
    {
      key: 'due',
      label: 'Due',
      type: 'date',
      required: false,
      visibleToCustomer: true,
      order: 1,
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_admin' } })
  hoisted.policyActorFromAuth.mockResolvedValue({ type: 'user', principalId: 'principal_admin' })
  hoisted.getTicketType.mockResolvedValue(bugType)
  hoisted.createTicket.mockResolvedValue({ id: 'ticket_new' })
})

describe('createTicketFn — save-path field validation (Phase 5 gate 2)', () => {
  it('rejects a poisoned suggestion: a select value outside the type options never reaches the service', async () => {
    await expect(
      createTicketFn({
        data: {
          ticketTypeId: TICKET_TYPE_ID,
          title: 'CSV export broken',
          customAttributes: { severity: 'Critical' },
        },
      })
    ).rejects.toThrow(/Severity is not a valid option/)
    expect(hoisted.createTicket).not.toHaveBeenCalled()
  })

  it('rejects a malformed date suggestion', async () => {
    await expect(
      createTicketFn({
        data: {
          ticketTypeId: TICKET_TYPE_ID,
          title: 'CSV export broken',
          customAttributes: { severity: 'High', due: 'next Friday' },
        },
      })
    ).rejects.toThrow(/Due must be a valid date/)
    expect(hoisted.createTicket).not.toHaveBeenCalled()
  })

  it('accepts in-schema values and passes the cleaned customAttributes through', async () => {
    await createTicketFn({
      data: {
        ticketTypeId: TICKET_TYPE_ID,
        title: 'CSV export broken',
        customAttributes: { severity: 'High', due: '2026-07-20', smuggled: 'dropped' },
      },
    })
    expect(hoisted.createTicket).toHaveBeenCalledTimes(1)
    const [input] = hoisted.createTicket.mock.calls[0]
    expect(input.customAttributes).toEqual({ severity: 'High', due: '2026-07-20' })
    expect(input.ticketTypeId).toBe(TICKET_TYPE_ID)
  })

  it('still gates on ticket.create', async () => {
    await createTicketFn({
      data: {
        ticketTypeId: TICKET_TYPE_ID,
        title: 'CSV export broken',
        customAttributes: { severity: 'High' },
      },
    })
    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.TICKET_CREATE })
  })
})
