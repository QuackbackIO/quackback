// @vitest-environment happy-dom
/**
 * Smoke coverage for the ticket settings cards: the status table renders a row
 * per status returned by `listTicketStatusesFn`, and the stage-label inputs load
 * their values from `getTicketStageLabelsFn`.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { Suspense } from 'react'
import type { DragEndEvent } from '@dnd-kit/core'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
    id: 'ticket_status_3',
    name: 'Escalated',
    slug: 'escalated',
    color: '#f97316',
    category: 'open',
    position: 1,
    isDefault: false,
    publicStage: 'in_progress',
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

// Drag gestures need layout, which happy-dom lacks: capture the drag-end handler
// the list gives the DndContext and call it with a real event shape.
const dnd = vi.hoisted(() => ({ onDragEnd: null as ((event: DragEndEvent) => void) | null }))
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  return {
    ...actual,
    DndContext: (props: { onDragEnd?: (event: DragEndEvent) => void; children: never }) => {
      dnd.onDragEnd = props.onDragEnd ?? null
      return <actual.DndContext {...props} />
    },
  }
})

vi.mock('@/lib/server/functions/tickets', () => ({
  listTicketStatusesFn: vi.fn(async () => FIXTURE_STATUSES),
  getTicketStageLabelsFn: vi.fn(async () => STAGE_LABELS),
  createTicketStatusFn: vi.fn(),
  updateTicketStatusFn: vi.fn(),
  reorderTicketStatusesFn: vi.fn(),
  deleteTicketStatusFn: vi.fn(),
  setTicketStageLabelsFn: vi.fn(),
}))

import {
  updateTicketStatusFn,
  setTicketStageLabelsFn,
  reorderTicketStatusesFn,
} from '@/lib/server/functions/tickets'
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
  const noop = () => {}

  it('renders a row per status from listTicketStatusesFn', async () => {
    renderWithClient(<TicketStatusList creating={false} onCreatingChange={noop} />)
    expect(await screen.findByText('Triage')).toBeInTheDocument()
    expect(await screen.findByText('Done')).toBeInTheDocument()
  })

  it('groups statuses in a card per category headed by its SLA behaviour', async () => {
    renderWithClient(<TicketStatusList creating={false} onCreatingChange={noop} />)
    await screen.findByText('Triage')
    expect(screen.getByText('Open · SLA runs')).toBeInTheDocument()
    expect(screen.getByText('Closed · SLA stops')).toBeInTheDocument()
    // No table chrome: the category column and its chips are gone.
    expect(screen.queryByText('Category')).toBeNull()
  })

  it('shows a named drag grip on every row, not only on hover', async () => {
    renderWithClient(<TicketStatusList creating={false} onCreatingChange={noop} />)
    await screen.findByText('Triage')
    for (const name of ['Triage', 'Escalated', 'Done']) {
      const grip = screen.getByRole('button', { name: `Reorder ${name}` })
      expect(grip.querySelector('svg')?.getAttribute('class')).not.toMatch(/opacity-0/)
    }
  })

  it('saves the new order of a category after a drag', async () => {
    vi.mocked(reorderTicketStatusesFn).mockResolvedValue(undefined as never)
    renderWithClient(<TicketStatusList creating={false} onCreatingChange={noop} />)
    await screen.findByText('Triage')
    dnd.onDragEnd?.({
      active: { id: 'ticket_status_3' },
      over: { id: 'ticket_status_1' },
    } as DragEndEvent)
    await waitFor(() => expect(reorderTicketStatusesFn).toHaveBeenCalledTimes(1))
    expect(vi.mocked(reorderTicketStatusesFn).mock.calls[0][0]).toEqual({
      data: { orderedIds: ['ticket_status_3', 'ticket_status_1'] },
    })
  })

  it('marks the default status with a lock, not a Default chip', async () => {
    renderWithClient(<TicketStatusList creating={false} onCreatingChange={noop} />)
    await screen.findByText('Triage')
    expect(screen.getByLabelText('Default status')).toBeInTheDocument()
    expect(screen.queryByText('Default')).toBeNull()
  })

  it('offers Delete from the row menu for a removable status, never for the default', async () => {
    const user = userEvent.setup()
    renderWithClient(<TicketStatusList creating={false} onCreatingChange={noop} />)
    await user.click(await screen.findByRole('button', { name: 'Actions for Escalated' }))
    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: 'Actions for Triage' }))
    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull()
  })

  it('shows Delete disabled with the reason for the last status in a category', async () => {
    const user = userEvent.setup()
    renderWithClient(<TicketStatusList creating={false} onCreatingChange={noop} />)
    await user.click(await screen.findByRole('button', { name: 'Actions for Done' }))
    expect(await screen.findByRole('menuitem', { name: /Delete/ })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    expect(screen.getByText('Keep at least one status in each category')).toBeInTheDocument()
  })

  it('saves a customer stage change as an autosave mutation', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <Suspense fallback={<div>loading</div>}>
          <TicketStatusList creating={false} onCreatingChange={() => {}} />
        </Suspense>
      </QueryClientProvider>
    )
    await user.click(await screen.findByRole('combobox', { name: 'Customer stage for Escalated' }))
    await user.click(await screen.findByRole('option', { name: 'Received' }))
    await vi.waitFor(() => expect(updateTicketStatusFn).toHaveBeenCalled())
    expect(updateTicketStatusFn).toHaveBeenCalledWith({
      data: { id: 'ticket_status_3', publicStage: 'received' },
    })
    expect(queryClient.getMutationCache().getAll()[0]?.options.meta).toEqual({ autosave: true })
  })

  it('rolls back the first stage change when it fails while a second save is in flight', async () => {
    const user = userEvent.setup()
    let failFirst!: (e: Error) => void
    vi.mocked(updateTicketStatusFn)
      .mockReset()
      .mockImplementationOnce(() => new Promise((_, reject) => (failFirst = reject)) as never)
      .mockImplementationOnce((async ({ data }: { data: { id: string } }) => ({
        ...FIXTURE_STATUSES.find((x) => x.id === data.id)!,
        publicStage: 'in_progress',
      })) as never)
    renderWithClient(<TicketStatusList creating={false} onCreatingChange={noop} />)
    await user.click(await screen.findByRole('combobox', { name: 'Customer stage for Escalated' }))
    await user.click(await screen.findByRole('option', { name: 'Received' }))
    await user.click(screen.getByRole('combobox', { name: 'Customer stage for Done' }))
    await user.click(await screen.findByRole('option', { name: 'In progress' }))
    await vi.waitFor(() => expect(updateTicketStatusFn).toHaveBeenCalledTimes(2))
    failFirst(new Error('boom'))
    await vi.waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: 'Customer stage for Escalated' })
      ).toHaveTextContent('In progress')
    )
    expect(screen.getByRole('combobox', { name: 'Customer stage for Done' })).toHaveTextContent(
      'In progress'
    )
  })

  it('opens the create dialog when the page asks for a new status', async () => {
    renderWithClient(<TicketStatusList creating onCreatingChange={noop} />)
    expect(await screen.findByRole('heading', { name: 'New status' })).toBeInTheDocument()
  })
})

describe('StageLabelsCard', () => {
  it('loads stage labels from getTicketStageLabelsFn into the inputs', async () => {
    renderWithClient(<StageLabelsCard />)
    const received = await screen.findByLabelText('Just submitted, not picked up yet')
    expect(received).toHaveValue('Received')
  })

  it('reverts every label whose save failed, even with another save in flight', async () => {
    const rejects: Array<(e: Error) => void> = []
    vi.mocked(setTicketStageLabelsFn)
      .mockReset()
      .mockImplementation(() => new Promise((_, reject) => rejects.push(reject)) as never)
    renderWithClient(<StageLabelsCard />)
    const received = await screen.findByLabelText('Just submitted, not picked up yet')
    const resolved = screen.getByLabelText('Marked done')
    fireEvent.change(received, { target: { value: 'Got it' } })
    fireEvent.blur(received)
    fireEvent.change(resolved, { target: { value: 'Finished' } })
    fireEvent.blur(resolved)
    await vi.waitFor(() => expect(rejects).toHaveLength(2))
    rejects[0](new Error('boom'))
    await vi.waitFor(() => expect(received).toHaveValue('Received'))
    expect(received).not.toBeDisabled()
    rejects[1](new Error('boom'))
    await vi.waitFor(() => expect(resolved).toHaveValue('Resolved'))
    expect(resolved).not.toBeDisabled()
  })
})
