import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockAuth = vi.fn()
const mockList = vi.fn()
const mockAdd = vi.fn()
const mockRemove = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...a: unknown[]) => mockAuth(...a),
}))
vi.mock('@/lib/server/domains/tickets/ticket-sharing.service', () => ({
  listTicketParticipants: (...a: unknown[]) => mockList(...a),
  addTicketParticipantByEmail: (...a: unknown[]) => mockAdd(...a),
  removeTicketParticipant: (...a: unknown[]) => mockRemove(...a),
}))

import { ValidationError } from '@/lib/shared/errors'
import { Route as ParticipantsRoute } from '../$ticketId.participants'
import { Route as ParticipantRoute } from '../$ticketId.participants.$principalId'

type Handler = (a: { request: Request; params: Record<string, string> }) => Promise<Response>
const handler = (route: unknown, method: 'GET' | 'POST' | 'DELETE'): Handler =>
  (route as { options: { server: { handlers: Record<string, Handler> } } }).options.server.handlers[
    method
  ]

const TICKET_ID = 'ticket_01h455vb4pex5vsknk084sn02q'
const COLE_ID = 'principal_01h455vb4pex5vsknk084sn02q'
const BASE = `https://x.test/api/v1/tickets/${TICKET_ID}/participants`

const participant = {
  principalId: COLE_ID,
  displayName: 'Cole',
  email: 'cole@example.com',
  avatarUrl: null,
  addedByPrincipalId: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({
    principalId: 'principal_key',
    role: 'admin',
    permissions: new Set(['ticket.view', 'ticket.reply']),
  })
  mockList.mockResolvedValue([participant])
})

describe('GET /api/v1/tickets/:id/participants', () => {
  it('lists the customers a ticket is shared with, on ticket.view', async () => {
    const res = await handler(
      ParticipantsRoute,
      'GET'
    )({ request: new Request(BASE), params: { ticketId: TICKET_ID } })
    expect(res.status).toBe(200)
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), { permission: 'ticket.view' })
    expect((await res.json()).data).toEqual([participant])
    expect(mockList.mock.calls[0][1].principalType).toBe('service')
  })
})

describe('POST /api/v1/tickets/:id/participants', () => {
  const post = (body: unknown) =>
    handler(
      ParticipantsRoute,
      'POST'
    )({
      request: new Request(BASE, { method: 'POST', body: JSON.stringify(body) }),
      params: { ticketId: TICKET_ID },
    })

  it('shares by email on ticket.reply: 201 when shared, 200 when they already had it', async () => {
    mockAdd.mockResolvedValueOnce({ principalId: COLE_ID, added: true })
    const created = await post({ email: 'cole@example.com' })
    expect(created.status).toBe(201)
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), { permission: 'ticket.reply' })
    expect(mockAdd).toHaveBeenCalledWith(TICKET_ID, 'cole@example.com', expect.anything())

    mockAdd.mockResolvedValueOnce({ principalId: COLE_ID, added: false })
    expect((await post({ email: 'cole@example.com' })).status).toBe(200)
  })

  it('400s a missing or malformed email before reaching the service', async () => {
    expect((await post({})).status).toBe(400)
    expect((await post({ email: 'not-an-email' })).status).toBe(400)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('400s a ticket with no customer thread', async () => {
    mockAdd.mockRejectedValue(
      new ValidationError('TICKET_NOT_SHAREABLE', 'Only customer tickets can be shared')
    )
    const res = await post({ email: 'cole@example.com' })
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toContain('Only customer tickets can be shared')
  })
})

describe('DELETE /api/v1/tickets/:id/participants/:principalId', () => {
  it('stops sharing on ticket.reply and answers 204', async () => {
    mockRemove.mockResolvedValue({ removed: true })
    const res = await handler(
      ParticipantRoute,
      'DELETE'
    )({
      request: new Request(`${BASE}/${COLE_ID}`, { method: 'DELETE' }),
      params: { ticketId: TICKET_ID, principalId: COLE_ID },
    })
    expect(res.status).toBe(204)
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), { permission: 'ticket.reply' })
    expect(mockRemove).toHaveBeenCalledWith(TICKET_ID, COLE_ID, expect.anything())
  })

  it('400s a malformed principal id', async () => {
    const res = await handler(
      ParticipantRoute,
      'DELETE'
    )({
      request: new Request(`${BASE}/nope`, { method: 'DELETE' }),
      params: { ticketId: TICKET_ID, principalId: 'nope' },
    })
    expect(res.status).toBe(400)
    expect(mockRemove).not.toHaveBeenCalled()
  })
})
