// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { TicketId, TicketStatusId } from '@quackback/ids'
import type { TicketDTO } from '@/lib/server/domains/tickets'

const { mockTicket, setTicketStatusFn } = vi.hoisted(() => {
  const mockTicket = {
    id: 'ticket_1',
    number: 1,
    reference: '#1',
    type: 'customer',
    title: 'Test',
    status: { id: 'ticket_status_2', name: 'Closed', color: '#9ca3af', category: 'closed' },
    stage: { slot: null, label: null },
    priority: 'none',
    requester: null,
    assignee: { principalId: null, displayName: null, teamId: null, teamName: null },
    company: null,
    firstResponseAt: null,
    dueAt: null,
    resolvedAt: null,
    createdAt: '2026-07-03T00:00:00.000Z',
    updatedAt: '2026-07-03T00:00:00.000Z',
    reopenedCount: 0,
    lastMessagePreview: 'Test',
    lastMessageAt: null,
  } as TicketDTO
  return { mockTicket, setTicketStatusFn: vi.fn(async () => mockTicket) }
})

// The status dropdown's onClick calls useSetTicketStatus().mutate — assert that
// path reaches the gated server fn with the right payload.
vi.mock('@/lib/server/functions/tickets', () => ({
  setTicketStatusFn,
  assignTicketFn: vi.fn(),
  setTicketPriorityFn: vi.fn(),
  createTicketFn: vi.fn(),
  listTicketsFn: vi.fn(),
  getTicketFn: vi.fn(),
  listTicketStatusesFn: vi.fn(),
}))

import { useSetTicketStatus } from '@/lib/client/mutations/tickets'
import { ticketKeys } from '@/lib/client/queries/tickets'

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

describe('useSetTicketStatus', () => {
  beforeEach(() => setTicketStatusFn.mockClear())

  it('posts the ticket + status to setTicketStatusFn and seeds the detail cache', async () => {
    const client = new QueryClient()
    const { result } = renderHook(() => useSetTicketStatus(), { wrapper: wrapper(client) })

    result.current.mutate({
      ticketId: 'ticket_1' as TicketId,
      statusId: 'ticket_status_2' as TicketStatusId,
    })

    await waitFor(() =>
      expect(setTicketStatusFn).toHaveBeenCalledWith({
        data: { ticketId: 'ticket_1', statusId: 'ticket_status_2' },
      })
    )
    await waitFor(() =>
      expect(client.getQueryData(ticketKeys.detail('ticket_1' as TicketId))).toEqual(mockTicket)
    )
  })
})
