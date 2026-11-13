// @vitest-environment happy-dom
/**
 * The thread's ticket header shows the shared due date under the stage
 * tracker, always in view (not inside the collapsed Details), and drops it
 * once the ticket is closed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { RequesterTicketDTO } from '@/lib/server/domains/tickets'
import {
  portalVisitorRpc,
  VisitorSurfaceRpcProvider,
  type VisitorSurfaceRpc,
} from '@/lib/client/visitor-surface-rpc'
import { TicketHeaderCard } from '../ticket-header-card'

vi.mock('@/lib/server/functions/tickets', () => ({
  createMyTicketFn: vi.fn(),
  getConversationLinkedTicketFn: vi.fn(),
  getMyTicketStageLabelsFn: vi.fn(),
  getMyTicketFormFn: vi.fn(),
  getMyTicketWatchStatusFn: vi.fn(),
  watchMyTicketFn: vi.fn(),
  unwatchMyTicketFn: vi.fn(),
}))

afterEach(cleanup)

const rpc = {
  ...portalVisitorRpc,
  getMyTicketStageLabels: vi.fn(async () => null),
  getMyTicketForm: vi.fn(async () => ({ types: [] })),
  getMyTicketWatchStatus: vi.fn(async () => ({ watching: false })),
} as unknown as VisitorSurfaceRpc

function ticket(overrides: Partial<RequesterTicketDTO> = {}): RequesterTicketDTO {
  return {
    id: 'ticket_1',
    number: 42,
    reference: '#42',
    type: 'customer',
    ticketType: null,
    title: 'Renewal paperwork',
    status: null,
    stage: { slot: 'in_progress', label: 'In progress', closed: false },
    priority: 'none',
    requester: null,
    assignee: null,
    company: null,
    firstResponseAt: null,
    dueAt: '2026-10-21T12:00:00.000Z',
    resolvedAt: null,
    sla: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    reopenedCount: 0,
    customAttributes: {},
    lastMessagePreview: null,
    lastMessageAt: null,
    ...overrides,
  } as unknown as RequesterTicketDTO
}

function renderHeader(t: RequesterTicketDTO) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en-US" messages={{}}>
        <VisitorSurfaceRpcProvider value={rpc}>
          <TicketHeaderCard ticket={t} />
        </VisitorSurfaceRpcProvider>
      </IntlProvider>
    </QueryClientProvider>
  )
}

describe('TicketHeaderCard due date', () => {
  it('shows the due date without opening Details', () => {
    renderHeader(ticket())
    expect(screen.getByRole('button', { name: /details/i })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    expect(screen.getByText('Oct 21, 2026')).toBeTruthy()
    expect(screen.getByText(/^Due$/).textContent).toBe('Due Oct 21, 2026')
  })

  it('shows no due date when none is set', () => {
    renderHeader(ticket({ dueAt: null }))
    expect(screen.queryByText(/^Due$/)).toBeNull()
  })

  it('hides the due date once the ticket is closed', () => {
    renderHeader(ticket({ stage: { slot: 'resolved', label: 'Resolved', closed: true } }))
    expect(screen.queryByText(/^Due$/)).toBeNull()
  })
})
