// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

const auth = { user: { id: 'user_a' }, sessionVersion: 1 }
const ticketsBySession: Record<number, unknown[]> = {
  1: [ticket('tkt_a', 'open')],
  2: [ticket('tkt_b', 'resolved')],
}

function ticket(id: string, slot: string) {
  return {
    ticketId: id,
    reference: `#${id}`,
    title: `Ticket ${id}`,
    stage: { slot, label: slot, closed: false },
    conversationId: `cnv_${id}`,
    updatedAt: '2026-11-25T10:00:00Z',
  }
}

vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({
    sessionVersion: auth.sessionVersion,
    user: auth.user,
    isIdentified: true,
    identityResolved: true,
  }),
}))
vi.mock('@/lib/client/widget-auth', () => ({ getWidgetAuthHeaders: () => ({}) }))
vi.mock('@/lib/server/functions/widget/tickets', () => ({
  widgetGetMyTicketsFn: () => Promise.resolve({ tickets: ticketsBySession[auth.sessionVersion] }),
}))

import { WidgetTickets } from '../widget-tickets'

beforeEach(() => localStorage.clear())

it('marks the rows that changed for the person now signed in, not the one before', async () => {
  localStorage.setItem('quackback:ticket-stages-seen:user_a', JSON.stringify({ tkt_a: 'open' }))
  localStorage.setItem('quackback:ticket-stages-seen:user_b', JSON.stringify({ tkt_b: 'open' }))
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui = () => (
    <QueryClientProvider client={qc}>
      <IntlProvider locale="en" messages={{}}>
        <WidgetTickets onOpenTicket={() => {}} />
      </IntlProvider>
    </QueryClientProvider>
  )
  const view = render(ui())
  await screen.findByText('Ticket tkt_a')

  // The host signs A out and B in while the Tickets tab stays mounted.
  auth.user = { id: 'user_b' }
  auth.sessionVersion = 2
  view.rerender(ui())
  await screen.findByText('Ticket tkt_b')
  expect(screen.getByText('Status changed since your last visit')).toBeTruthy()
})
