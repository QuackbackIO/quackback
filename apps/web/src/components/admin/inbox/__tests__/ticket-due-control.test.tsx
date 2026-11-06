// @vitest-environment happy-dom
/**
 * The detail panel's due date control holds a draft while its picker is open
 * and saves once on close (only when the date moved); clearing saves null at
 * once. A customer-type ticket says the customer sees the date. The chip
 * beside it counts down with the tone `ticketDueState` gives.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IntlProvider } from 'react-intl'
import type { TicketId } from '@quackback/ids'
import type { TicketDTO } from '@/lib/server/domains/tickets'

const hoisted = vi.hoisted(() => ({
  mutate: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/lib/client/mutations/inbox', () => ({
  useSetTicketDueAt: () => ({ mutate: hoisted.mutate, isPending: false, variables: undefined }),
}))
vi.mock('sonner', () => ({ toast: { error: hoisted.toastError } }))

import { TicketDueChip, TicketDueControl } from '../ticket-due-control'

function ticket(overrides: Partial<TicketDTO> = {}): TicketDTO {
  return {
    id: 'ticket_1' as TicketId,
    type: 'customer',
    dueAt: null,
    resolvedAt: null,
    ...overrides,
  } as TicketDTO
}

function renderControl(t: TicketDTO) {
  return render(
    <IntlProvider locale="en" defaultLocale="en">
      <TicketDueControl ticket={t} />
    </IntlProvider>
  )
}

const closePicker = () =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

beforeEach(() => {
  hoisted.mutate.mockReset()
  hoisted.toastError.mockReset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('TicketDueControl', () => {
  it('saves once when the picker closes, with the last pick', () => {
    renderControl(ticket())
    fireEvent.click(screen.getByRole('button', { name: 'Set due date' }))
    fireEvent.click(screen.getByText('15'))
    fireEvent.click(screen.getByText('16'))
    expect(hoisted.mutate).not.toHaveBeenCalled()

    closePicker()
    expect(hoisted.mutate).toHaveBeenCalledTimes(1)
    const [vars] = hoisted.mutate.mock.calls[0]
    expect(vars.ticketId).toBe('ticket_1')
    expect(vars.dueAt).toBeInstanceOf(Date)
    expect(vars.dueAt.getDate()).toBe(16)
    expect(vars.dueAt.getHours()).toBe(9)
  })

  it('does not save when the picker closes unchanged', () => {
    renderControl(ticket({ dueAt: '2026-10-21T15:00:00.000Z' }))
    fireEvent.click(screen.getByRole('button', { name: /2026/ }))
    closePicker()
    expect(hoisted.mutate).not.toHaveBeenCalled()
  })

  it('clears straight away with a null due date', () => {
    renderControl(ticket({ dueAt: '2026-10-21T15:00:00.000Z' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear due date' }))
    expect(hoisted.mutate).toHaveBeenCalledTimes(1)
    expect(hoisted.mutate.mock.calls[0][0]).toEqual({ ticketId: 'ticket_1', dueAt: null })
  })

  it('shows a toast when the save fails', () => {
    hoisted.mutate.mockImplementation((_vars, opts: { onError: () => void }) => opts.onError())
    renderControl(ticket({ dueAt: '2026-10-21T15:00:00.000Z' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear due date' }))
    expect(hoisted.toastError).toHaveBeenCalledWith('Failed to update the due date')
  })

  it('tells the teammate the customer sees the date on a customer ticket', () => {
    renderControl(ticket({ type: 'customer' }))
    expect(screen.getByText('The customer sees this date.')).toBeInTheDocument()
  })

  it('has no customer hint on an internal ticket', () => {
    renderControl(ticket({ type: 'back_office' }))
    expect(screen.queryByText('The customer sees this date.')).not.toBeInTheDocument()
  })
})

describe('TicketDueChip', () => {
  const NOW = new Date('2026-10-14T12:00:00.000Z')

  function renderChip(dueAt: string | null, closed = false) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    return render(
      <IntlProvider locale="en" defaultLocale="en">
        <TicketDueChip dueAt={dueAt} closed={closed} />
      </IntlProvider>
    )
  }

  it('reads as overdue once the date has passed', async () => {
    const { container } = renderChip('2026-10-14T10:00:00.000Z')
    await act(async () => {})
    expect(container.textContent).toBe('2h over')
    expect(container.firstElementChild!.className).toContain('text-red-700')
  })

  it('reads as due soon within the next 24 hours', async () => {
    const { container } = renderChip('2026-10-14T17:30:00.000Z')
    await act(async () => {})
    expect(container.textContent).toBe('5h 30m')
    expect(container.firstElementChild!.className).toContain('text-amber-700')
  })

  it('stays muted further out', async () => {
    const { container } = renderChip('2026-10-20T12:00:00.000Z')
    await act(async () => {})
    expect(container.textContent).toBe('6d')
    expect(container.firstElementChild!.className).toContain('bg-muted')
  })

  it('renders nothing on a closed ticket or with no due date', async () => {
    const closed = renderChip('2026-10-14T10:00:00.000Z', true)
    await act(async () => {})
    expect(closed.container.textContent).toBe('')
    cleanup()
    const none = renderChip(null)
    await act(async () => {})
    expect(none.container.textContent).toBe('')
  })
})
