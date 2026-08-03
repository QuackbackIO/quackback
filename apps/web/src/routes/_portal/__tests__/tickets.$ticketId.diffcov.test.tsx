// @vitest-environment happy-dom

import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

type ComponentProps = {
  children?: ReactNode
  className?: string
  onClick?: () => void
  disabled?: boolean
  variant?: string
  size?: string
}

type QueryOptions = { queryKey: readonly unknown[] }

type MutationOptions<TVars, TResult> = {
  mutationFn: (vars: TVars) => Promise<TResult>
  onSuccess?: (result: TResult) => void
  onError?: (error: Error) => void
}

type RouteOptions = {
  parseParams: (params: { ticketId: string }) => { ticketId: string }
  loader: (input: {
    context: {
      session?: { user?: { id?: string } } | null
      queryClient: { ensureQueryData: (query: unknown) => Promise<unknown> }
      settings?: { name?: string }
    }
    params: { ticketId: string }
  }) => Promise<{ workspaceName: string }>
  head: (input: { loaderData?: { workspaceName?: string } }) => { meta: Array<{ title: string }> }
  component: () => ReactElement
}

type TicketData = {
  ticket: {
    subject: string
    statusName: string
    statusCategory: 'open' | 'pending' | 'on_hold' | 'solved' | 'closed'
    createdAt: Date
    lastActivityAt: Date
    updatedAt: Date
    descriptionText: string | null
    descriptionJson: unknown
  }
  threads: unknown[]
  principalNames: Record<string, string>
  viewerPrincipalId: string
  viewerRelationship: 'requester' | 'collaborator' | 'watcher'
}

const mocks = vi.hoisted(() => ({
  isValidTypeId: vi.fn((_value: string, _prefix?: string) => true),
  ensureQueryData: vi.fn(async () => undefined),
  invalidateQueries: vi.fn(),
  getQueryData: vi.fn(),
  setQueryData: vi.fn(),
  closeMyTicketFn: vi.fn(async () => ({})),
  reopenMyTicketFn: vi.fn(async () => ({})),
  updateMyTicketDescriptionFn: vi.fn(async () => ({ updatedAt: new Date('2026-02-02T00:00:00Z') })),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  data: null as TicketData | null,
  // record props passed to the thread feed so we can invoke its callbacks
  threadFeedProps: null as {
    onDescriptionUpdate?: (json: unknown, text: string | null) => void
    isDescriptionSaving?: boolean
  } | null,
}))

function freshData(
  overrides: Partial<TicketData['ticket']> & {
    viewerRelationship?: TicketData['viewerRelationship']
  } = {}
): TicketData {
  const { viewerRelationship, ...ticketOverrides } = overrides
  return {
    ticket: {
      subject: 'Broken billing',
      statusName: 'Open',
      statusCategory: 'open',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      lastActivityAt: new Date('2026-01-02T00:00:00Z'),
      updatedAt: new Date('2026-01-03T00:00:00Z'),
      descriptionText: 'A description',
      descriptionJson: { type: 'doc', content: [] },
      ...ticketOverrides,
    },
    threads: [],
    principalNames: { 'principal-1': 'Alice' },
    viewerPrincipalId: 'principal-1',
    viewerRelationship: viewerRelationship ?? 'requester',
  }
}

vi.mock('@quackback/ids', () => ({
  isValidTypeId: (value: string, prefix?: string) => mocks.isValidTypeId(value, prefix),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useParams: () => ({ ticketId: 'ticket_abc' }),
  }),
  redirect: (input: unknown) => {
    throw { redirect: input }
  },
  notFound: () => {
    throw { notFound: true }
  },
  Link: ({ children, to }: ComponentProps & { to?: string }) => <a href={to}>{children}</a>,
}))

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: () => ({ data: mocks.data }),
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
    getQueryData: mocks.getQueryData,
    setQueryData: mocks.setQueryData,
  }),
  useMutation: <TVars, TResult>(options: MutationOptions<TVars, TResult>) => ({
    isPending: false,
    mutate: async (vars: TVars) => {
      try {
        const result = await options.mutationFn(vars)
        options.onSuccess?.(result)
      } catch (error) {
        options.onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    },
  }),
}))

vi.mock('react-intl', () => ({
  FormattedMessage: ({ defaultMessage }: { defaultMessage: string }) => <>{defaultMessage}</>,
}))

vi.mock('@heroicons/react/24/outline', () => ({
  ArrowLeftIcon: () => <svg data-testid="arrow-left" />,
}))

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}))

vi.mock('@/lib/client/queries/portal-tickets', () => ({
  portalTicketQueries: {
    detail: (ticketId: string): QueryOptions => ({
      queryKey: ['portal', 'tickets', 'detail', ticketId],
    }),
  },
}))

vi.mock('@/lib/server/functions/portal-tickets', () => ({
  updateMyTicketDescriptionFn: mocks.updateMyTicketDescriptionFn,
  closeMyTicketFn: mocks.closeMyTicketFn,
  reopenMyTicketFn: mocks.reopenMyTicketFn,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled }: ComponentProps) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/public/tickets/portal-ticket-detail-header', () => ({
  PortalTicketDetailHeader: ({ subject }: { subject: string }) => <h1>{subject}</h1>,
}))

vi.mock('@/components/public/tickets/portal-ticket-thread-feed', () => ({
  PortalTicketThreadFeed: (props: {
    onDescriptionUpdate?: (json: unknown, text: string | null) => void
    isDescriptionSaving?: boolean
  }) => {
    mocks.threadFeedProps = props
    return (
      <div data-testid="thread-feed">
        saving:{String(props.isDescriptionSaving)} editable:
        {String(Boolean(props.onDescriptionUpdate))}
      </div>
    )
  },
}))

vi.mock('@/components/public/tickets/portal-ticket-reply-composer', () => ({
  PortalTicketReplyComposer: ({ ticketId, isClosed }: { ticketId: string; isClosed: boolean }) => (
    <div data-testid="composer">
      composer:{ticketId}:{String(isClosed)}
    </div>
  ),
}))

const { Route } = await import('../tickets.$ticketId')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

function renderPage() {
  const Component = routeOptions().component
  return render(<Component />)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isValidTypeId.mockReturnValue(true)
  mocks.ensureQueryData.mockResolvedValue(undefined)
  mocks.getQueryData.mockReturnValue(undefined)
  mocks.closeMyTicketFn.mockResolvedValue({})
  mocks.reopenMyTicketFn.mockResolvedValue({})
  mocks.updateMyTicketDescriptionFn.mockResolvedValue({
    updatedAt: new Date('2026-02-02T00:00:00Z'),
  })
  mocks.data = freshData()
  mocks.threadFeedProps = null
})

describe('portal ticket detail route — parseParams', () => {
  it('returns the typed ticketId for a valid id', () => {
    mocks.isValidTypeId.mockReturnValue(true)
    expect(routeOptions().parseParams({ ticketId: 'ticket_abc' })).toEqual({
      ticketId: 'ticket_abc',
    })
  })

  it('throws notFound for an invalid id', () => {
    mocks.isValidTypeId.mockReturnValue(false)
    expect(() => routeOptions().parseParams({ ticketId: 'nope' })).toThrow()
    try {
      routeOptions().parseParams({ ticketId: 'nope' })
    } catch (e) {
      expect(e).toEqual({ notFound: true })
    }
  })
})

describe('portal ticket detail route — loader', () => {
  it('redirects anonymous users to portal login', async () => {
    await expect(
      routeOptions().loader({
        context: {
          session: null,
          queryClient: { ensureQueryData: mocks.ensureQueryData },
          settings: { name: 'Acme' },
        },
        params: { ticketId: 'ticket_abc' },
      })
    ).rejects.toEqual({ redirect: { to: '/auth/login', search: { next: '/tickets/ticket_abc' } } })
    expect(mocks.ensureQueryData).not.toHaveBeenCalled()
  })

  it('prefetches the ticket and returns the workspace name on success', async () => {
    const result = await routeOptions().loader({
      context: {
        session: { user: { id: 'user-1' } },
        queryClient: { ensureQueryData: mocks.ensureQueryData },
        settings: { name: 'Acme' },
      },
      params: { ticketId: 'ticket_abc' },
    })

    expect(result).toEqual({ workspaceName: 'Acme' })
    expect(mocks.ensureQueryData).toHaveBeenCalledWith({
      queryKey: ['portal', 'tickets', 'detail', 'ticket_abc'],
    })
  })

  it('defaults workspace name to empty string when settings are absent', async () => {
    const result = await routeOptions().loader({
      context: {
        session: { user: { id: 'user-1' } },
        queryClient: { ensureQueryData: mocks.ensureQueryData },
      },
      params: { ticketId: 'ticket_abc' },
    })
    expect(result).toEqual({ workspaceName: '' })
  })

  it('converts a TICKET_NOT_FOUND domain error into a notFound', async () => {
    mocks.ensureQueryData.mockRejectedValueOnce({ code: 'TICKET_NOT_FOUND' })
    await expect(
      routeOptions().loader({
        context: {
          session: { user: { id: 'user-1' } },
          queryClient: { ensureQueryData: mocks.ensureQueryData },
          settings: { name: 'Acme' },
        },
        params: { ticketId: 'ticket_abc' },
      })
    ).rejects.toEqual({ notFound: true })
  })

  it('rethrows non-notFound errors', async () => {
    const boom = new Error('boom')
    mocks.ensureQueryData.mockRejectedValueOnce(boom)
    await expect(
      routeOptions().loader({
        context: {
          session: { user: { id: 'user-1' } },
          queryClient: { ensureQueryData: mocks.ensureQueryData },
          settings: { name: 'Acme' },
        },
        params: { ticketId: 'ticket_abc' },
      })
    ).rejects.toBe(boom)
  })
})

describe('portal ticket detail route — head', () => {
  it('builds a workspace-scoped title when a name is present', () => {
    expect(routeOptions().head({ loaderData: { workspaceName: 'Acme' } })).toEqual({
      meta: [{ title: 'Ticket · Acme' }],
    })
  })

  it('falls back to a plain title when there is no workspace name', () => {
    expect(routeOptions().head({ loaderData: { workspaceName: '' } })).toEqual({
      meta: [{ title: 'Ticket' }],
    })
    expect(routeOptions().head({})).toEqual({ meta: [{ title: 'Ticket' }] })
  })
})

describe('portal ticket detail route — component', () => {
  it('renders the active requester view with a solve action and editable description', async () => {
    mocks.data = freshData({ statusCategory: 'open', viewerRelationship: 'requester' })
    renderPage()

    expect(screen.getByText('Broken billing')).toBeTruthy()
    expect(screen.getByText('My tickets')).toBeTruthy()
    // requester + active → composer rendered, editable description
    expect(screen.getByTestId('composer').textContent).toContain('false')
    expect(screen.getByTestId('thread-feed').textContent).toContain('editable:true')

    fireEvent.click(screen.getByRole('button', { name: 'Mark as solved' }))
    await waitFor(() =>
      expect(mocks.closeMyTicketFn).toHaveBeenCalledWith({ data: { ticketId: 'ticket_abc' } })
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Ticket marked as solved')
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['portal', 'tickets', 'list'],
    })
  })

  it('surfaces a close failure through a toast error', async () => {
    mocks.data = freshData({ statusCategory: 'open', viewerRelationship: 'requester' })
    mocks.closeMyTicketFn.mockRejectedValueOnce(new Error('cannot close'))
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Mark as solved' }))
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('cannot close'))
  })

  it('renders a reopen action for a solved requester ticket', async () => {
    mocks.data = freshData({ statusCategory: 'solved', viewerRelationship: 'requester' })
    renderPage()

    // solved → not active, so no "Mark as solved"; reopen present
    expect(screen.queryByRole('button', { name: 'Mark as solved' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))
    await waitFor(() =>
      expect(mocks.reopenMyTicketFn).toHaveBeenCalledWith({ data: { ticketId: 'ticket_abc' } })
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Ticket reopened')
  })

  it('surfaces a reopen failure through a toast error', async () => {
    mocks.data = freshData({ statusCategory: 'solved', viewerRelationship: 'requester' })
    mocks.reopenMyTicketFn.mockRejectedValueOnce(new Error('cannot reopen'))
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('cannot reopen'))
  })

  it('renders a collaborator view: composer present, description not editable', () => {
    mocks.data = freshData({ statusCategory: 'open', viewerRelationship: 'collaborator' })
    renderPage()

    expect(screen.queryByRole('button', { name: 'Mark as solved' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull()
    expect(screen.getByTestId('composer')).toBeTruthy()
    expect(screen.getByTestId('thread-feed').textContent).toContain('editable:false')
  })

  it('renders a watcher view with the watching notice instead of a composer', () => {
    mocks.data = freshData({ statusCategory: 'open', viewerRelationship: 'watcher' })
    renderPage()

    expect(screen.queryByTestId('composer')).toBeNull()
    expect(
      screen.getByText('You are watching this ticket. Only requesters and collaborators can reply.')
    ).toBeTruthy()
  })

  it('keeps the description read-only when a requester ticket is closed', () => {
    mocks.data = freshData({ statusCategory: 'closed', viewerRelationship: 'requester' })
    renderPage()

    // closed → composer flagged closed, description not editable, no solve/reopen
    expect(screen.getByTestId('composer').textContent).toContain('true')
    expect(screen.getByTestId('thread-feed').textContent).toContain('editable:false')
    expect(screen.queryByRole('button', { name: 'Mark as solved' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull()
  })

  it('saves a description edit using the cached expectedUpdatedAt and updates the cache', async () => {
    mocks.data = freshData({ statusCategory: 'open', viewerRelationship: 'requester' })
    const cached = freshData({ updatedAt: new Date('2026-05-05T00:00:00Z') })
    mocks.getQueryData.mockReturnValue(cached)
    renderPage()

    const json = { type: 'doc', content: [] }
    mocks.threadFeedProps?.onDescriptionUpdate?.(json, 'updated text')

    await waitFor(() => expect(mocks.updateMyTicketDescriptionFn).toHaveBeenCalled())
    expect(mocks.updateMyTicketDescriptionFn).toHaveBeenCalledWith({
      data: {
        ticketId: 'ticket_abc',
        expectedUpdatedAt: cached.ticket.updatedAt,
        descriptionJson: json,
        descriptionText: 'updated text',
      },
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Description updated')
    // setQueryData updater runs both with current and (in fallback) without
    expect(mocks.setQueryData).toHaveBeenCalled()
    const updater = mocks.setQueryData.mock.calls[0][1] as (c: TicketData | undefined) => unknown
    expect(updater(cached)).toMatchObject({
      ticket: { updatedAt: new Date('2026-02-02T00:00:00Z') },
    })
    expect(updater(undefined)).toBeUndefined()
  })

  it('falls back to the loaded updatedAt when no detail is cached', async () => {
    mocks.data = freshData({ statusCategory: 'open', viewerRelationship: 'requester' })
    mocks.getQueryData.mockReturnValue(undefined)
    renderPage()

    mocks.threadFeedProps?.onDescriptionUpdate?.(null, null)

    await waitFor(() =>
      expect(mocks.updateMyTicketDescriptionFn).toHaveBeenCalledWith({
        data: {
          ticketId: 'ticket_abc',
          expectedUpdatedAt: new Date('2026-01-03T00:00:00Z'),
          descriptionJson: null,
          descriptionText: null,
        },
      })
    )
  })

  it('shows a refresh-specific toast when a description save conflicts', async () => {
    mocks.data = freshData({ statusCategory: 'open', viewerRelationship: 'requester' })
    mocks.updateMyTicketDescriptionFn.mockRejectedValueOnce(new Error('stale write detected'))
    renderPage()

    mocks.threadFeedProps?.onDescriptionUpdate?.({ type: 'doc' }, 'x')
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('Ticket changed — please refresh')
    )
  })

  it('shows the raw error toast for a non-conflict description save failure', async () => {
    mocks.data = freshData({ statusCategory: 'open', viewerRelationship: 'requester' })
    mocks.updateMyTicketDescriptionFn.mockRejectedValueOnce(new Error('server exploded'))
    renderPage()

    mocks.threadFeedProps?.onDescriptionUpdate?.({ type: 'doc' }, 'x')
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('server exploded'))
  })
})
