// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { ConversationId, TicketId } from '@quackback/ids'

const authState = { isIdentified: true }

vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({ sessionVersion: 0, isIdentified: authState.isIdentified }),
}))
vi.mock('@/lib/client/widget-auth', () => ({
  getWidgetAuthHeaders: () => ({}),
}))

const ticket = (
  n: number,
  overrides: {
    conversationId?: ConversationId | null
    slot?: string | null
    dueAt?: string | null
    closed?: boolean
  } = {}
) => ({
  ticketId: `tkt_${n}` as TicketId,
  reference: `#${n}`,
  title: `Ticket ${n}`,
  stage: {
    slot: ('slot' in overrides ? overrides.slot : 'open') as 'open' | null,
    label: 'Open',
    closed: overrides.closed ?? false,
  },
  conversationId: ('conversationId' in overrides
    ? overrides.conversationId
    : `cnv_${n}`) as ConversationId | null,
  updatedAt: '2026-07-30T10:00:00Z',
  dueAt: overrides.dueAt ?? null,
})

const myTickets = { tickets: [ticket(1), ticket(2), ticket(3), ticket(4)] }

vi.mock('@/lib/server/functions/widget/tickets', () => ({
  widgetGetMyTicketsFn: () => Promise.resolve(myTickets),
}))

import { WidgetRecentTicketsCard } from '../widget-recent-tickets'

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <IntlProvider locale="en" messages={{}}>
        {children}
      </IntlProvider>
    </QueryClientProvider>
  )
}

describe('WidgetRecentTicketsCard', () => {
  it('shows at most 3 of the requester tickets', async () => {
    render(<WidgetRecentTicketsCard onOpenTicket={() => {}} />, { wrapper })
    expect(await screen.findByText('Ticket 3')).toBeTruthy()
    expect(screen.queryByText('Ticket 4')).toBeNull()
  })

  it('opens the ticket thread via its pair conversation id', async () => {
    const onOpenTicket = vi.fn()
    render(<WidgetRecentTicketsCard onOpenTicket={onOpenTicket} />, { wrapper })
    fireEvent.click(await screen.findByText('Ticket 2'))
    expect(onOpenTicket).toHaveBeenCalledWith('cnv_2')
  })

  it('renders nothing when the requester has no tickets', async () => {
    myTickets.tickets = []
    const { container } = render(<WidgetRecentTicketsCard onOpenTicket={() => {}} />, { wrapper })
    await vi.waitFor(() => {
      expect(container.querySelector('ul')).toBeNull()
    })
    myTickets.tickets = [ticket(1), ticket(2), ticket(3), ticket(4)]
  })

  it('renders nothing for an anonymous visitor', () => {
    authState.isIdentified = false
    const { container } = render(<WidgetRecentTicketsCard onOpenTicket={() => {}} />, { wrapper })
    expect(container.firstChild).toBeNull()
    authState.isIdentified = true
  })

  it('shows the due date on open tickets that have one, never on closed ones', async () => {
    myTickets.tickets = [
      ticket(1, { dueAt: '2026-10-21T12:00:00.000Z' }),
      ticket(2),
      ticket(3, { dueAt: '2026-11-02T12:00:00.000Z', closed: true }),
    ]
    render(<WidgetRecentTicketsCard onOpenTicket={() => {}} />, { wrapper })
    expect(await screen.findByText('Ticket 1')).toBeTruthy()
    const dueLabels = screen.getAllByText(/^Due$/)
    expect(dueLabels.map((el) => el.textContent)).toEqual(['Due Oct 21, 2026'])
    myTickets.tickets = [ticket(1), ticket(2), ticket(3), ticket(4)]
  })
})
