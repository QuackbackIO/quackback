// @vitest-environment happy-dom
/**
 * Smoke coverage for the ticket settings cards: the status table renders a row
 * per status returned by `listTicketStatusesFn`, and the stage-label inputs load
 * their values from `getTicketStageLabelsFn`.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { Suspense } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const FIXTURE_STATUSES = [
  {
    id: 'ticket_status_1',
    name: 'Triage',
    slug: 'triage',
    color: '#3b82f6',
    category: 'open',
    position: 0,
    isDefault: true,
    publicStage: 'received',
    createdAt: new Date(),
    deletedAt: null,
  },
  {
    id: 'ticket_status_2',
    name: 'Done',
    slug: 'done',
    color: '#22c55e',
    category: 'closed',
    position: 0,
    isDefault: false,
    publicStage: 'resolved',
    createdAt: new Date(),
    deletedAt: null,
  },
]

const STAGE_LABELS = {
  received: 'Received',
  in_progress: 'In progress',
  awaiting_requester: 'Awaiting your reply',
  resolved: 'Resolved',
}

vi.mock('@/lib/server/functions/tickets', () => ({
  listTicketStatusesFn: vi.fn(async () => FIXTURE_STATUSES),
  getTicketStageLabelsFn: vi.fn(async () => STAGE_LABELS),
  createTicketStatusFn: vi.fn(),
  updateTicketStatusFn: vi.fn(),
  reorderTicketStatusesFn: vi.fn(),
  deleteTicketStatusFn: vi.fn(),
  setTicketStageLabelsFn: vi.fn(),
}))

import { TicketStatusList } from '../ticket-status-list'
import { StageLabelsCard } from '../stage-labels-card'

// Radix Select relies on these pointer/layout APIs happy-dom does not implement.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

afterEach(cleanup)

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<div>loading</div>}>{ui}</Suspense>
    </QueryClientProvider>
  )
}

describe('TicketStatusList', () => {
  it('renders a row per status from listTicketStatusesFn', async () => {
    renderWithClient(<TicketStatusList />)
    expect(await screen.findByText('Triage')).toBeInTheDocument()
    expect(await screen.findByText('Done')).toBeInTheDocument()
  })

  it('marks the default status', async () => {
    renderWithClient(<TicketStatusList />)
    expect(await screen.findByText('Default')).toBeInTheDocument()
  })
})

describe('StageLabelsCard', () => {
  it('loads stage labels from getTicketStageLabelsFn into the inputs', async () => {
    renderWithClient(<StageLabelsCard />)
    const received = await screen.findByLabelText('Just submitted, not picked up yet')
    expect(received).toHaveValue('Received')
  })
})
