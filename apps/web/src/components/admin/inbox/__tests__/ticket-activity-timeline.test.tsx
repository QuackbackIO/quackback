// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { TicketId } from '@quackback/ids'

// activityQueries imports the server fn modules; stub them so no server code loads.
vi.mock('@/lib/server/functions/tickets', () => ({}))
vi.mock('@/lib/server/functions/activity', () => ({}))

import { TicketActivityTimeline } from '../ticket-activity-timeline'
import { activityQueries } from '@/lib/client/queries/activity'

const TICKET = 'ticket_1' as TicketId

function activity(id: string, actorName: string | null, actorViaApi?: boolean) {
  return {
    id,
    ticketId: TICKET,
    principalId: actorName ? `principal_${id}` : null,
    type: 'ticket.created' as const,
    metadata: {},
    createdAt: '2026-11-19T10:00:00.000Z',
    actorName,
    ...(actorViaApi ? { actorViaApi } : {}),
  }
}

function renderTimeline(rows: ReturnType<typeof activity>[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(activityQueries.forTicket(TICKET).queryKey, rows as never)
  render(
    <IntlProvider locale="en" messages={{}}>
      <QueryClientProvider client={qc}>
        <TicketActivityTimeline ticketId={TICKET} />
      </QueryClientProvider>
    </IntlProvider>
  )
}

afterEach(cleanup)

describe('TicketActivityTimeline via API mark', () => {
  it('marks an action an API key took under its own name', () => {
    renderTimeline([activity('a', 'ops-bot', true)])
    const row = screen.getByText(/ops-bot created this ticket/)
    expect(row).toHaveTextContent('via API')
  })

  it('leaves a teammate, and a system action, unmarked', () => {
    renderTimeline([activity('b', 'Dana Ivers'), activity('c', null)])
    expect(screen.getByText(/Dana Ivers created this ticket/)).toBeInTheDocument()
    expect(screen.getByText(/System created this ticket/)).toBeInTheDocument()
    expect(screen.queryByText('via API')).not.toBeInTheDocument()
  })
})
