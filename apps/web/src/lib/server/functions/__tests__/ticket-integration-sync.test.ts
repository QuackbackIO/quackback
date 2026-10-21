/**
 * syncTicketIntegrationsFn: resyncing a ticket with its linked issues is
 * gated like the links themselves (ticket.assign), runs as the caller's
 * policy actor so the service can check the ticket is visible to them, and
 * returns what it queued.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => {
    let handler: ((args: { data: unknown }) => Promise<unknown>) | null = null
    const fn = (args: { data: unknown }) => {
      if (!handler) throw new Error('handler not registered')
      return handler(args)
    }
    fn.validator = () => fn
    fn.handler = (h: (args: { data: unknown }) => Promise<unknown>) => {
      handler = h
      return fn
    }
    return fn
  },
}))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  policyActorFromAuth: vi.fn(),
  syncTicketIntegrations: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
  policyActorFromAuth: hoisted.policyActorFromAuth,
}))
vi.mock('@/lib/server/integrations/ticket-sync', () => ({
  syncTicketIntegrations: hoisted.syncTicketIntegrations,
}))

import { syncTicketIntegrationsFn } from '../tickets'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { NotFoundError } from '@/lib/shared/errors'

const actor = { principalId: 'principal_agent', role: 'member' }

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_agent', role: 'member' } })
  hoisted.policyActorFromAuth.mockResolvedValue(actor)
  hoisted.syncTicketIntegrations.mockResolvedValue({ inbound: 2, outbound: 1 })
})

describe('syncTicketIntegrationsFn', () => {
  it('requires ticket.assign and resyncs as the caller', async () => {
    await expect(syncTicketIntegrationsFn({ data: { ticketId: 'ticket_1' } })).resolves.toEqual({
      inbound: 2,
      outbound: 1,
    })
    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.TICKET_ASSIGN })
    expect(hoisted.syncTicketIntegrations).toHaveBeenCalledWith('ticket_1', actor)
  })

  it('stops at the gate, and passes on a ticket the caller cannot see', async () => {
    hoisted.requireAuth.mockRejectedValueOnce(new Error('Forbidden'))
    await expect(syncTicketIntegrationsFn({ data: { ticketId: 'ticket_1' } })).rejects.toThrow(
      'Forbidden'
    )
    expect(hoisted.syncTicketIntegrations).not.toHaveBeenCalled()

    hoisted.syncTicketIntegrations.mockRejectedValueOnce(
      new NotFoundError('TICKET_NOT_FOUND', 'Ticket not found')
    )
    await expect(syncTicketIntegrationsFn({ data: { ticketId: 'ticket_2' } })).rejects.toThrow(
      'Ticket not found'
    )
  })
})
