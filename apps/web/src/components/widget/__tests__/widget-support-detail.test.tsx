// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WidgetSupportDetail } from '../widget-support-detail'

type QueryState = {
  data?: WidgetTicketDetailResponse
  isLoading?: boolean
  error?: unknown
}

type WidgetTicketDetailResponse = {
  ticket: {
    id: string
    subject: string
    descriptionJson: unknown | null
    descriptionText: string | null
    statusId: string
    statusCategory: 'open' | 'pending' | 'on_hold' | 'solved' | 'closed'
    statusName: string
    statusColor: string | null
    createdAt: string
    lastActivityAt: string
    updatedAt: string
  }
  threads: Array<{
    id: string
    principalId: string | null
    audience: 'public'
    bodyJson: unknown | null
    bodyText: string | null
    createdAt: string
    editedAt: string | null
  }>
  principalNames: Record<string, string>
  viewerPrincipalId: string | null
}

const mocks = vi.hoisted(() => {
  class MockWidgetTicketError extends Error {
    readonly code: string
    readonly status: number

    constructor(code: string, message: string, status: number) {
      super(message)
      this.name = 'WidgetTicketError'
      this.code = code
      this.status = status
    }
  }

  return {
    queryState: { isLoading: false } as QueryState,
    latestData: undefined as WidgetTicketDetailResponse | undefined,
    invalidateQueries: vi.fn(async () => undefined),
    getQueryData: vi.fn(),
    setQueryData: vi.fn(),
    emitEvent: vi.fn(),
    getWidgetTicket: vi.fn(),
    replyToWidgetTicket: vi.fn(),
    resolveWidgetTicket: vi.fn(),
    reopenWidgetTicket: vi.fn(),
    updateWidgetTicketDescription: vi.fn(),
    WidgetTicketError: MockWidgetTicketError,
  }
})

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(() => mocks.queryState),
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
    getQueryData: mocks.getQueryData,
    setQueryData: mocks.setQueryData,
  }),
}))

vi.mock('react-intl', () => ({
  FormattedMessage: ({ defaultMessage }: { defaultMessage: string }) => <>{defaultMessage}</>,
  useIntl: () => ({
    formatMessage: ({ defaultMessage }: { defaultMessage: string }) => defaultMessage,
  }),
}))

vi.mock('@/components/ui/time-ago', () => ({
  TimeAgo: ({ date }: { date: string }) => <span>{date}</span>,
}))

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/admin/tickets/ticket-thread-feed', () => ({
  TicketThreadFeed: ({
    threads,
    principalNames,
    description,
    onDescriptionUpdate,
    isDescriptionSaving,
  }: {
    threads: Array<{ id: string; bodyText: string; principalId: string | null }>
    principalNames: Record<string, string>
    description: { text: string | null; json: unknown | null } | null
    onDescriptionUpdate?: (json: { type: 'doc'; content?: unknown[] }, text: string) => void
    isDescriptionSaving?: boolean
  }) => (
    <section data-testid="thread-feed">
      <div>thread-count:{threads.length}</div>
      {threads.map((thread) => (
        <article key={thread.id}>
          <span>{thread.bodyText}</span>
          <span>{thread.principalId ? principalNames[thread.principalId] : 'anonymous'}</span>
        </article>
      ))}
      <div>description:{description?.text ?? 'none'}</div>
      <div>{onDescriptionUpdate ? 'description editable' : 'description readonly'}</div>
      <div>{isDescriptionSaving ? 'description saving' : 'description idle'}</div>
      {onDescriptionUpdate ? (
        <button
          type="button"
          onClick={() =>
            onDescriptionUpdate(
              { type: 'doc', content: [{ type: 'paragraph', content: [] }] },
              'Updated description'
            )
          }
        >
          Update description
        </button>
      ) : null}
    </section>
  ),
}))

vi.mock('@/lib/client/widget/tickets-api', () => ({
  getWidgetTicket: mocks.getWidgetTicket,
  replyToWidgetTicket: mocks.replyToWidgetTicket,
  resolveWidgetTicket: mocks.resolveWidgetTicket,
  reopenWidgetTicket: mocks.reopenWidgetTicket,
  updateWidgetTicketDescription: mocks.updateWidgetTicketDescription,
  WidgetTicketError: mocks.WidgetTicketError,
}))

vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({
    sessionVersion: 3,
    emitEvent: mocks.emitEvent,
  }),
}))

function ticketDetail(
  overrides: Partial<WidgetTicketDetailResponse['ticket']> = {}
): WidgetTicketDetailResponse {
  return {
    ticket: {
      id: 'ticket_1',
      subject: 'Widget cannot load invoices',
      descriptionJson: { type: 'doc', content: [] },
      descriptionText: 'Initial description',
      statusId: 'ticket_status_open',
      statusCategory: 'open',
      statusName: 'Open',
      statusColor: '#0ea5e9',
      createdAt: '2026-06-19T10:00:00.000Z',
      lastActivityAt: '2026-06-19T10:00:00.000Z',
      updatedAt: '2026-06-19T10:15:00.000Z',
      ...overrides,
    },
    threads: [
      {
        id: 'ticket_thread_1',
        principalId: 'principal_viewer',
        audience: 'public',
        bodyJson: null,
        bodyText: 'I need help with invoices',
        createdAt: '2026-06-19T10:01:00.000Z',
        editedAt: null,
      },
      {
        id: 'ticket_thread_2',
        principalId: 'principal_agent',
        audience: 'public',
        bodyJson: null,
        bodyText: null,
        createdAt: '2026-06-19T10:02:00.000Z',
        editedAt: null,
      },
    ],
    principalNames: {
      principal_agent: 'Support agent',
      principal_viewer: 'Requester from API',
    },
    viewerPrincipalId: 'principal_viewer',
  }
}

function renderDetail(state: QueryState) {
  mocks.latestData = state.data
  mocks.queryState = {
    isLoading: false,
    error: null,
    ...state,
  }
  mocks.getQueryData.mockImplementation(() => mocks.latestData)

  return render(<WidgetSupportDetail ticketId="ticket_1" />)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.latestData = undefined
  mocks.queryState = { isLoading: false, error: null }
  mocks.replyToWidgetTicket.mockResolvedValue({ id: 'ticket_thread_reply' })
  mocks.resolveWidgetTicket.mockResolvedValue({
    id: 'ticket_1',
    statusId: 'ticket_status_solved',
    statusCategory: 'solved',
    alreadyResolved: false,
  })
  mocks.reopenWidgetTicket.mockResolvedValue({
    id: 'ticket_1',
    statusId: 'ticket_status_open',
    statusCategory: 'open',
    alreadyOpen: false,
  })
  mocks.updateWidgetTicketDescription.mockResolvedValue({
    id: 'ticket_1',
    updatedAt: '2026-06-19T10:30:00.000Z',
  })
})

describe('WidgetSupportDetail', () => {
  it('renders loading and load failure states', () => {
    const { unmount } = renderDetail({ isLoading: true })

    expect(screen.getByText('', { selector: '.animate-pulse' })).toBeInTheDocument()

    unmount()
    renderDetail({ error: new Error('load failed') })

    expect(screen.getByText('Could not load this ticket.')).toBeInTheDocument()
  })

  it('renders an open ticket and supports reply and resolve actions', async () => {
    renderDetail({ data: ticketDetail() })

    expect(screen.getByRole('heading', { name: 'Widget cannot load invoices' })).toBeInTheDocument()
    expect(screen.getByText('Open')).toBeInTheDocument()
    expect(screen.getByText('thread-count:2')).toBeInTheDocument()
    expect(screen.getByText('I need help with invoices')).toBeInTheDocument()
    expect(screen.getByText('You')).toBeInTheDocument()
    expect(screen.getByText('Support agent')).toBeInTheDocument()
    expect(screen.getByText('description:Initial description')).toBeInTheDocument()
    expect(screen.getByText('description editable')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Type your reply...'), {
      target: { value: 'Thanks for checking' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))

    await waitFor(() => {
      expect(mocks.replyToWidgetTicket).toHaveBeenCalledWith('ticket_1', 'Thanks for checking')
    })
    expect(mocks.emitEvent).toHaveBeenCalledWith('ticket:replied', {
      ticketId: 'ticket_1',
      threadId: 'ticket_thread_reply',
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['widget', 'tickets', 'detail', 'ticket_1', 3],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Mark as resolved' }))

    await waitFor(() => {
      expect(mocks.resolveWidgetTicket).toHaveBeenCalledWith('ticket_1')
    })
    expect(mocks.emitEvent).toHaveBeenCalledWith('ticket:resolved', {
      ticketId: 'ticket_1',
      statusId: 'ticket_status_solved',
      alreadyResolved: false,
    })
  })

  it('uses the latest cached timestamp when updating a description', async () => {
    const data = ticketDetail()
    const latest = ticketDetail({ updatedAt: '2026-06-19T10:29:00.000Z' })
    mocks.getQueryData.mockReturnValue(latest)
    renderDetail({ data })
    mocks.getQueryData.mockReturnValue(latest)

    fireEvent.click(screen.getByRole('button', { name: 'Update description' }))

    await waitFor(() => {
      expect(mocks.updateWidgetTicketDescription).toHaveBeenCalledWith('ticket_1', {
        expectedUpdatedAt: '2026-06-19T10:29:00.000Z',
        descriptionJson: { type: 'doc', content: [{ type: 'paragraph', content: [] }] },
        descriptionText: 'Updated description',
      })
    })
    expect(mocks.emitEvent).toHaveBeenCalledWith('ticket:description_updated', {
      ticketId: 'ticket_1',
      updatedAt: '2026-06-19T10:30:00.000Z',
    })
    expect(mocks.setQueryData).toHaveBeenCalledWith(
      ['widget', 'tickets', 'detail', 'ticket_1', 3],
      expect.any(Function)
    )

    const update = mocks.setQueryData.mock.calls[0][1] as (
      current: WidgetTicketDetailResponse
    ) => WidgetTicketDetailResponse
    expect(update(data).ticket.updatedAt).toBe('2026-06-19T10:30:00.000Z')
  })

  it('shows widget API errors for reply, resolve, and description saves', async () => {
    mocks.replyToWidgetTicket.mockRejectedValueOnce(
      new mocks.WidgetTicketError('FORBIDDEN', 'Reply is not allowed', 403)
    )
    mocks.resolveWidgetTicket.mockRejectedValueOnce(
      new mocks.WidgetTicketError('CONFLICT', 'Already closed elsewhere', 409)
    )
    mocks.updateWidgetTicketDescription.mockRejectedValueOnce(
      new mocks.WidgetTicketError('STALE', 'Description changed elsewhere', 409)
    )
    renderDetail({ data: ticketDetail() })

    fireEvent.change(screen.getByPlaceholderText('Type your reply...'), {
      target: { value: 'Blocked reply' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
    expect(await screen.findByText('Reply is not allowed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Mark as resolved' }))
    expect(await screen.findByText('Already closed elsewhere')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Update description' }))
    expect(await screen.findByText('Description changed elsewhere')).toBeInTheDocument()
  })

  it('renders a solved ticket as read-only and allows reopening', async () => {
    renderDetail({
      data: ticketDetail({
        statusId: 'ticket_status_solved',
        statusCategory: 'solved',
        statusName: 'Solved',
      }),
    })

    expect(screen.getByText('Resolved')).toBeInTheDocument()
    expect(screen.getByText('description readonly')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Type your reply...')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark as resolved' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))

    await waitFor(() => {
      expect(mocks.reopenWidgetTicket).toHaveBeenCalledWith('ticket_1')
    })
    expect(mocks.emitEvent).toHaveBeenCalledWith('ticket:reopened', {
      ticketId: 'ticket_1',
      statusId: 'ticket_status_open',
      alreadyOpen: false,
    })
  })

  it('shows reopen API errors for solved tickets', async () => {
    mocks.reopenWidgetTicket.mockRejectedValueOnce(
      new mocks.WidgetTicketError('FORBIDDEN', 'Reopen is not allowed', 403)
    )
    renderDetail({
      data: ticketDetail({
        statusId: 'ticket_status_solved',
        statusCategory: 'solved',
        statusName: 'Solved',
      }),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))

    expect(await screen.findByText('Reopen is not allowed')).toBeInTheDocument()
  })
})
