import { render, screen } from '@testing-library/react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TicketActivityTimeline } from '../ticket-activity-timeline'

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: vi.fn(),
}))

vi.mock('@/lib/client/queries/tickets', () => ({
  ticketQueries: {
    activity: vi.fn(() => ({ queryKey: ['tickets', 'activity'] })),
  },
}))

vi.mock('@/components/ui/time-ago', () => ({
  TimeAgo: () => <span>2 minutes ago</span>,
}))

const useSuspenseQueryMock = vi.mocked(useSuspenseQuery)

function mockActivity(rows: unknown[]) {
  useSuspenseQueryMock.mockReturnValue({ data: rows } as never)
}

describe('TicketActivityTimeline', () => {
  beforeEach(() => {
    useSuspenseQueryMock.mockReset()
  })

  it('renders description changes without exposing raw diff metadata or principal IDs', () => {
    mockActivity([
      {
        id: 'ticket_act_1',
        principalId: 'principal_01ktxq7sh1fevtx68ee59xpvx0',
        type: 'ticket.updated',
        actorName: null,
        createdAt: '2026-06-12T10:00:00.000Z',
        metadata: {
          diff: {
            descriptionText: {
              from: 'old raw description',
              to: 'new raw description',
            },
          },
        },
      },
    ])

    render(<TicketActivityTimeline ticketId={'ticket_1' as never} />)

    expect(screen.getByText('Someone updated the description')).toBeInTheDocument()
    expect(screen.getByText('Description changed')).toBeInTheDocument()
    expect(screen.queryByText(/descriptionText/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/principal_01ktxq7/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/old raw description/i)).not.toBeInTheDocument()
  })

  it('renders field, status, and thread activity as readable summaries', () => {
    mockActivity([
      {
        id: 'ticket_act_1',
        principalId: 'principal_1',
        type: 'ticket.updated',
        actorName: 'Meli',
        createdAt: '2026-06-12T10:00:00.000Z',
        metadata: {
          diff: {
            priority: { from: 'normal', to: 'urgent' },
          },
        },
      },
      {
        id: 'ticket_act_2',
        principalId: null,
        type: 'ticket.status_changed',
        actorName: null,
        createdAt: '2026-06-12T09:00:00.000Z',
        metadata: {
          from: { statusId: 'ticket_status_old', category: 'open' },
          to: { statusId: 'ticket_status_new', category: 'pending' },
        },
      },
      {
        id: 'ticket_act_3',
        principalId: 'principal_2',
        type: 'thread.added',
        actorName: 'Agent',
        createdAt: '2026-06-12T08:00:00.000Z',
        metadata: { threadId: 'ticket_thread_1', audience: 'public' },
      },
    ])

    render(<TicketActivityTimeline ticketId={'ticket_1' as never} />)

    expect(screen.getByText('Meli changed priority')).toBeInTheDocument()
    expect(screen.getByText('Normal')).toBeInTheDocument()
    expect(screen.getByText('Urgent')).toBeInTheDocument()
    expect(screen.getByText('System changed status')).toBeInTheDocument()
    expect(screen.getByText('Open')).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('Agent posted a public reply')).toBeInTheDocument()
    expect(
      screen.queryByText(/ticket\.updated|thread\.added|ticket_thread_1/i)
    ).not.toBeInTheDocument()
  })
})
