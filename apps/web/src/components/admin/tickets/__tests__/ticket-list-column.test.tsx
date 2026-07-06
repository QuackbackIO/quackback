// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { TicketId, TicketStatusId, PrincipalId } from '@quackback/ids'
import type { TicketDTO } from '@/lib/server/domains/tickets'

// PriorityDot pulls the conversation priority control, which imports a server fn
// module; stub it so the presentational list renders without server code.
vi.mock('@/lib/server/functions/conversation', () => ({ setConversationPriorityFn: vi.fn() }))

import { TicketListColumn } from '../ticket-list-column'

function ticket(overrides: Partial<TicketDTO> = {}): TicketDTO {
  return {
    id: 'ticket_1' as TicketId,
    number: 142,
    reference: '#142',
    type: 'customer',
    title: 'Cannot log in',
    status: {
      id: 'ticket_status_1' as TicketStatusId,
      name: 'Open',
      color: '#10b981',
      category: 'open',
    },
    stage: { slot: 'received', label: 'Received' },
    priority: 'high',
    requester: {
      principalId: 'principal_1' as PrincipalId,
      displayName: 'Ada Lovelace',
      avatarUrl: null,
    },
    assignee: { principalId: null, displayName: null, teamId: null, teamName: null },
    company: null,
    firstResponseAt: null,
    dueAt: null,
    resolvedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    reopenedCount: 0,
    lastMessagePreview: 'Cannot log in',
    lastMessageAt: null,
    ...overrides,
  }
}

function renderColumn(tickets: TicketDTO[], loading = false) {
  return render(
    <TicketListColumn
      scope="all"
      onScope={vi.fn()}
      typeFilter={undefined}
      onTypeFilter={vi.fn()}
      statusCategory={undefined}
      onStatusCategory={vi.fn()}
      sort="recent"
      onSort={vi.fn()}
      loading={loading}
      tickets={tickets}
      selectedId={null}
      onSelect={vi.fn()}
      onNewTicket={vi.fn()}
    />
  )
}

describe('TicketListColumn', () => {
  afterEach(() => cleanup())

  it('renders a row per ticket with reference, title, and status', () => {
    renderColumn([
      ticket(),
      ticket({
        id: 'ticket_2' as TicketId,
        reference: '#143',
        title: 'Billing question',
        status: {
          id: 'ticket_status_2' as TicketStatusId,
          name: 'Waiting',
          color: '#f59e0b',
          category: 'pending',
        },
      }),
    ])
    expect(screen.getByText('#142')).toBeTruthy()
    expect(screen.getByText('Cannot log in')).toBeTruthy()
    expect(screen.getByText('#143')).toBeTruthy()
    expect(screen.getByText('Billing question')).toBeTruthy()
    expect(screen.getByText('Open')).toBeTruthy()
    expect(screen.getByText('Waiting')).toBeTruthy()
  })

  it('shows the empty state when there are no tickets', () => {
    renderColumn([])
    expect(screen.getByText('No tickets')).toBeTruthy()
  })
})
