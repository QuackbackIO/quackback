// @vitest-environment happy-dom
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

  it('renders an empty activity state', () => {
    mockActivity([])

    render(<TicketActivityTimeline ticketId={'ticket_1' as never} />)

    expect(screen.getByText('No activity yet.')).toBeInTheDocument()
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

  it('renders the remaining event types and summarized metadata', () => {
    mockActivity([
      {
        id: 'ticket_act_created',
        principalId: 'principal_1',
        type: 'ticket.created',
        actorName: null,
        createdAt: '2026-06-12T10:00:00.000Z',
        metadata: { statusCategory: 'closed', priority: 'high', channel: 'github' },
      },
      {
        id: 'ticket_act_routed',
        principalId: null,
        type: 'ticket.routed',
        actorName: null,
        createdAt: '2026-06-12T09:59:00.000Z',
        metadata: {
          ruleId: 'routing_rule_1',
          inboxId: 'inbox_1',
          primaryTeamId: 'team_1',
          assigneePrincipalId: 'principal_1',
        },
      },
      {
        id: 'ticket_act_updated_many',
        principalId: 'principal_2',
        type: 'ticket.updated',
        actorName: 'Agent',
        createdAt: '2026-06-12T09:58:00.000Z',
        metadata: {
          diff: {
            subject: { from: 'Old subject', to: 'New subject' },
            visibilityScope: { from: 'team', to: 'private' },
            customFlag: { from: false, to: true },
            score: { from: 1, to: 2 },
            assigneePrincipalId: {
              from: 'principal_01ktxq7sh1fevtx68ee59xpvx0',
              to: null,
            },
          },
        },
      },
      {
        id: 'ticket_act_assigned',
        principalId: 'principal_2',
        type: 'ticket.assigned',
        actorName: 'Agent',
        createdAt: '2026-06-12T09:57:00.000Z',
        metadata: {
          from: { teamId: 'team_old' },
          to: { principalId: 'principal_3', teamId: 'team_1' },
        },
      },
      {
        id: 'ticket_act_no_assignee',
        principalId: 'principal_2',
        type: 'ticket.assigned',
        actorName: 'Agent',
        createdAt: '2026-06-12T09:56:00.000Z',
        metadata: { from: {}, to: {} },
      },
      {
        id: 'ticket_act_unassigned',
        principalId: 'principal_2',
        type: 'ticket.unassigned',
        actorName: 'Agent',
        createdAt: '2026-06-12T09:55:00.000Z',
        metadata: {},
      },
      {
        id: 'ticket_act_deleted',
        principalId: 'principal_2',
        type: 'ticket.deleted',
        actorName: 'Agent',
        createdAt: '2026-06-12T09:54:00.000Z',
        metadata: {},
      },
      {
        id: 'ticket_act_restored',
        principalId: 'principal_2',
        type: 'ticket.restored',
        actorName: 'Agent',
        createdAt: '2026-06-12T09:53:00.000Z',
        metadata: {},
      },
      {
        id: 'ticket_act_thread_unknown',
        principalId: 'principal_2',
        type: 'thread.added',
        actorName: 'Agent',
        createdAt: '2026-06-12T09:52:00.000Z',
        metadata: { audience: 'shared-team' },
      },
      {
        id: 'ticket_act_thread_edited',
        principalId: 'principal_2',
        type: 'thread.edited',
        actorName: 'Agent',
        createdAt: '2026-06-12T09:51:00.000Z',
        metadata: {},
      },
      {
        id: 'ticket_act_thread_deleted',
        principalId: 'principal_2',
        type: 'thread.deleted',
        actorName: 'Agent',
        createdAt: '2026-06-12T09:50:00.000Z',
        metadata: {},
      },
      {
        id: 'ticket_act_participant_added',
        principalId: 'principal_2',
        type: 'participant.added',
        actorName: 'Agent',
        createdAt: '2026-06-12T09:49:00.000Z',
        metadata: { role: 'collaborator', principalId: 'principal_3', contactId: 'contact_1' },
      },
      {
        id: 'ticket_act_participant_removed',
        principalId: 'principal_2',
        type: 'participant.removed',
        actorName: 'Agent',
        createdAt: '2026-06-12T09:48:00.000Z',
        metadata: {},
      },
      {
        id: 'ticket_act_shared',
        principalId: 'principal_2',
        type: 'ticket.shared',
        actorName: 'Agent',
        createdAt: '2026-06-12T09:47:00.000Z',
        metadata: { accessLevel: 'full' },
      },
      {
        id: 'ticket_act_unshared',
        principalId: 'principal_2',
        type: 'ticket.unshared',
        actorName: 'Agent',
        createdAt: '2026-06-12T09:46:00.000Z',
        metadata: {},
      },
      {
        id: 'ticket_act_attachment_added',
        principalId: 'principal_2',
        type: 'attachment.added',
        actorName: 'Agent',
        createdAt: '2026-06-12T09:45:00.000Z',
        metadata: {
          filename:
            'very-long-diagnostic-bundle-name-that-should-be-truncated-before-rendering-because-it-is-more-than-one-hundred-and-twenty-characters.zip',
        },
      },
      {
        id: 'ticket_act_attachment_removed',
        principalId: 'principal_2',
        type: 'attachment.removed',
        actorName: 'Agent',
        createdAt: '2026-06-12T09:44:00.000Z',
        metadata: {},
      },
      {
        id: 'ticket_act_default',
        principalId: 'principal_2',
        type: 'custom.audit_event',
        actorName: '  ',
        createdAt: '2026-06-12T09:43:00.000Z',
        metadata: {},
      },
    ])

    render(
      <TicketActivityTimeline
        ticketId={'ticket_1' as never}
        principalNames={{ principal_1: 'Ada', principal_2: 'Grace' }}
      />
    )

    expect(screen.getByText('Ada created this ticket')).toBeInTheDocument()
    expect(screen.getByText('Closed')).toBeInTheDocument()
    expect(screen.getByText('GitHub')).toBeInTheDocument()
    expect(screen.getByText('System routed this ticket')).toBeInTheDocument()
    expect(screen.getByText('Matched routing rule')).toBeInTheDocument()
    expect(screen.getByText('Agent updated 5 fields')).toBeInTheDocument()
    expect(screen.getByText('Old subject')).toBeInTheDocument()
    expect(screen.getByText('Private')).toBeInTheDocument()
    expect(screen.getByText('Enabled')).toBeInTheDocument()
    expect(screen.getByText('Assigned to person and team')).toBeInTheDocument()
    expect(screen.getByText('Previously assigned')).toBeInTheDocument()
    expect(screen.getByText('No assignee')).toBeInTheDocument()
    expect(screen.getByText('Agent removed the assignee')).toBeInTheDocument()
    expect(screen.getByText('Agent deleted this ticket')).toBeInTheDocument()
    expect(screen.getByText('Agent restored this ticket')).toBeInTheDocument()
    expect(screen.getByText('Agent posted shared team')).toBeInTheDocument()
    expect(screen.getByText('Agent edited a reply')).toBeInTheDocument()
    expect(screen.getByText('Agent deleted a reply')).toBeInTheDocument()
    expect(screen.getByText('Agent added a participant')).toBeInTheDocument()
    expect(screen.getByText('Collaborator')).toBeInTheDocument()
    expect(screen.getByText('User')).toBeInTheDocument()
    expect(screen.getByText('Contact')).toBeInTheDocument()
    expect(screen.getByText('Agent removed a participant')).toBeInTheDocument()
    expect(screen.getByText('Agent shared this ticket with a team')).toBeInTheDocument()
    expect(screen.getByText('Full access')).toBeInTheDocument()
    expect(screen.getByText('Agent removed a team share')).toBeInTheDocument()
    expect(screen.getByText('Agent added an attachment')).toBeInTheDocument()
    expect(screen.getByText(/very-long-diagnostic-bundle-name/)).toBeInTheDocument()
    expect(screen.getByText('Agent removed an attachment')).toBeInTheDocument()
    expect(screen.getByText('Grace recorded Custom Audit Event')).toBeInTheDocument()
    expect(screen.queryByText(/principal_01ktxq7/i)).not.toBeInTheDocument()
  })
})
