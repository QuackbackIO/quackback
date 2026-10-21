// @vitest-environment happy-dom
/**
 * The ticket timeline's due date rows: a change reads "set the due date" (or
 * "cleared the due date") with a "{from} → {to}" line where a missing side
 * reads "No due date", and a ticket filed with a due date says so under its
 * "created" row.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { TicketId } from '@quackback/ids'
import { activityQueries } from '@/lib/client/queries/activity'
import { restoreRuntimeLocale, setRuntimeLocale } from '@/test/runtime-locale'
import { TicketActivityTimeline } from '../ticket-activity-timeline'

const TICKET_ID = 'ticket_1' as TicketId

function row(type: string, metadata: Record<string, unknown>, id = type) {
  return {
    id,
    ticketId: TICKET_ID,
    principalId: 'principal_1',
    type,
    metadata,
    createdAt: '2026-10-14T12:00:00.000Z',
    actorName: 'Maya',
  }
}

function renderTimeline(rows: ReturnType<typeof row>[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(activityQueries.forTicket(TICKET_ID).queryKey, rows as never)
  return render(
    <IntlProvider locale="en" defaultLocale="en">
      <QueryClientProvider client={client}>
        <TicketActivityTimeline ticketId={TICKET_ID} />
      </QueryClientProvider>
    </IntlProvider>
  )
}

beforeEach(() => {
  setRuntimeLocale('en-US', 'UTC')
})

afterEach(() => {
  cleanup()
  restoreRuntimeLocale()
})

describe('TicketActivityTimeline due date rows', () => {
  it('shows a newly set due date against "No due date"', () => {
    renderTimeline([row('due.changed', { from: null, to: '2026-10-21T17:00:00.000Z' })])
    expect(screen.getByText('Maya set the due date')).toBeInTheDocument()
    expect(screen.getByText('No due date → Oct 21, 2026, 5:00 PM')).toBeInTheDocument()
  })

  it('shows a moved due date from one date to the other', () => {
    renderTimeline([
      row('due.changed', { from: '2026-10-21T17:00:00.000Z', to: '2026-10-23T09:30:00.000Z' }),
    ])
    expect(screen.getByText('Maya set the due date')).toBeInTheDocument()
    expect(screen.getByText('Oct 21, 2026, 5:00 PM → Oct 23, 2026, 9:30 AM')).toBeInTheDocument()
  })

  it('reads a cleared due date as cleared', () => {
    renderTimeline([row('due.changed', { from: '2026-10-21T17:00:00.000Z', to: null })])
    expect(screen.getByText('Maya cleared the due date')).toBeInTheDocument()
    expect(screen.getByText('Oct 21, 2026, 5:00 PM → No due date')).toBeInTheDocument()
  })

  it('notes the due date a ticket was filed with', () => {
    renderTimeline([row('ticket.created', { dueAt: '2026-10-21T17:00:00.000Z' })])
    expect(screen.getByText('Maya created this ticket')).toBeInTheDocument()
    expect(screen.getByText('Due Oct 21, 2026, 5:00 PM')).toBeInTheDocument()
  })

  it('adds no due line to a ticket filed without one', () => {
    renderTimeline([row('ticket.created', { ticketType: 'customer' })])
    expect(screen.getByText('Maya created this ticket')).toBeInTheDocument()
    expect(screen.queryByText(/^Due /)).not.toBeInTheDocument()
  })
})
