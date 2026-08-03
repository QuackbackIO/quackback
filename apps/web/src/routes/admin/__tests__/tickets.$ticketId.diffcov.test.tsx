// @vitest-environment happy-dom

import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

type RouteOptions = {
  loader: (input: {
    params: { ticketId: string }
    context: { queryClient: { ensureQueryData: (query: unknown) => unknown } }
  }) => Promise<unknown>
  component: () => ReactElement
  errorComponent: () => ReactElement
}

type ComponentProps = {
  children?: ReactNode
  className?: string
  onClick?: () => void
}

type MutationOptions<T> = {
  mutationFn: (vars: unknown) => Promise<T>
  onSuccess?: (result: T) => void
  onError?: (error: Error) => void
}

const mocks = vi.hoisted(() => ({
  ensureQueryData: vi.fn(async () => undefined),
  invalidateQueries: vi.fn(),
  setQueryData: vi.fn(),
  getQueryData: vi.fn<(key: unknown) => unknown>(() => undefined),
  updateTicketFn: vi.fn(async () => ({ id: 'ticket-1', updatedAt: '2026-06-20T00:00:00.000Z' })),
  handleTicketConflict: vi.fn(),
  toastSuccess: vi.fn(),
  myPermissions: { data: undefined as unknown },
  // suspense query data, keyed by the third queryKey segment ('detail' etc. are
  // index 1, but we just key by a label we attach in the queries mock)
  queryData: {} as Record<string, unknown>,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useParams: () => ({ ticketId: 'ticket-1' }),
  }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
    setQueryData: mocks.setQueryData,
    getQueryData: mocks.getQueryData,
  }),
  useSuspenseQuery: (query: { queryKey: readonly unknown[] }) => ({
    data: mocks.queryData[query.queryKey[1] as string],
  }),
  useMutation: <T,>(options: MutationOptions<T>) => ({
    isPending: false,
    mutate: (vars: unknown) => {
      void options
        .mutationFn(vars)
        .then((result) => options.onSuccess?.(result))
        .catch((error: Error) => options.onError?.(error))
    },
  }),
}))

vi.mock('@/components/admin/shared', () => ({
  createRouteErrorComponent: (message: string) => () => <div>{message}</div>,
}))

vi.mock('@/lib/client/queries/tickets', () => ({
  ticketQueries: {
    detail: (ticketId: string) => ({ queryKey: ['tickets', 'detail', ticketId] }),
    threads: (ticketId: string) => ({ queryKey: ['tickets', 'threads', ticketId] }),
    participants: (ticketId: string) => ({ queryKey: ['tickets', 'participants', ticketId] }),
    shares: (ticketId: string) => ({ queryKey: ['tickets', 'shares', ticketId] }),
    statuses: () => ({ queryKey: ['tickets', 'statuses'] }),
    activity: (ticketId: string) => ({ queryKey: ['tickets', 'activity', ticketId] }),
  },
}))

vi.mock('@/lib/server/functions/tickets', () => ({
  updateTicketFn: mocks.updateTicketFn,
}))

vi.mock('@/lib/client/hooks/use-authz-queries', () => ({
  useMyPermissions: () => mocks.myPermissions,
}))

vi.mock('@/lib/client/utils/handle-ticket-conflict', () => ({
  handleTicketConflict: mocks.handleTicketConflict,
}))

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess },
}))

vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: ComponentProps) => <div>{children}</div>,
  TabsList: ({ children }: ComponentProps) => <div>{children}</div>,
  TabsTrigger: ({ children }: ComponentProps) => <button type="button">{children}</button>,
  TabsContent: ({ children }: ComponentProps) => <div>{children}</div>,
}))

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => <span className={className} />,
}))

vi.mock('@/components/admin/tickets/ticket-detail-header', () => ({
  TicketDetailHeader: ({
    currentPrincipalId,
    ticket,
  }: {
    currentPrincipalId: string
    ticket: { subject: string }
  }) => (
    <header>
      <span>subject:{ticket.subject}</span>
      <span data-testid="current-principal">{String(currentPrincipalId)}</span>
    </header>
  ),
}))

vi.mock('@/components/admin/tickets/ticket-thread-feed', () => ({
  TicketThreadFeed: ({
    principalNames,
    onDescriptionUpdate,
    isDescriptionSaving,
  }: {
    principalNames: Record<string, string>
    onDescriptionUpdate?: (json: unknown, text: string | null) => void
    isDescriptionSaving: boolean
  }) => (
    <div>
      <span data-testid="principal-names">{JSON.stringify(principalNames)}</span>
      <span data-testid="can-edit">{onDescriptionUpdate ? 'editable' : 'readonly'}</span>
      <span data-testid="saving">{String(isDescriptionSaving)}</span>
      {onDescriptionUpdate ? (
        <button
          type="button"
          onClick={() => onDescriptionUpdate({ type: 'doc', content: [] }, 'new description text')}
        >
          Update description
        </button>
      ) : null}
    </div>
  ),
}))

vi.mock('@/components/admin/tickets/ticket-thread-composer', () => ({
  TicketThreadComposer: ({
    canPublic,
    canInternal,
    canShared,
  }: {
    canPublic: boolean
    canInternal: boolean
    canShared: boolean
  }) => (
    <div data-testid="composer">
      {String(canPublic)}-{String(canInternal)}-{String(canShared)}
    </div>
  ),
}))

vi.mock('@/components/admin/tickets/ticket-properties-panel', () => ({
  TicketPropertiesPanel: ({ ticket }: { ticket: { id: string } }) => (
    <div data-testid="properties">{ticket.id}</div>
  ),
}))

vi.mock('@/components/admin/tickets/ticket-participants-list', () => ({
  TicketParticipantsList: ({ participants }: { participants: unknown[] }) => (
    <div data-testid="participants">{participants.length}</div>
  ),
}))

vi.mock('@/components/admin/tickets/ticket-shares-panel', () => ({
  TicketSharesPanel: ({ canShare }: { canShare: boolean }) => (
    <div data-testid="shares">{String(canShare)}</div>
  ),
}))

vi.mock('@/components/admin/tickets/ticket-sla-panel', () => ({
  TicketSlaPanel: () => <div data-testid="sla" />,
}))

vi.mock('@/components/admin/tickets/ticket-activity-timeline', () => ({
  TicketActivityTimeline: () => <div data-testid="activity" />,
}))

const { Route } = await import('../tickets.$ticketId')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

function seedTicket(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-1',
    subject: 'My ticket',
    channel: 'email',
    priority: 'normal',
    visibilityScope: 'public',
    statusId: 'status-1',
    primaryTeamId: 'team-primary',
    assigneeTeamId: 'team-assignee',
    inboxId: 'inbox-1',
    organizationId: 'org-1',
    requesterContactId: 'contact-1',
    assigneePrincipalId: 'principal-assignee',
    descriptionText: 'desc',
    descriptionJson: null,
    updatedAt: '2026-06-19T00:00:00.000Z',
    ...overrides,
  }
}

function seedQueries(overrides: Record<string, unknown> = {}) {
  mocks.queryData = {
    detail: seedTicket(),
    threads: [
      {
        id: 'thread-1',
        ticketId: 'ticket-1',
        principalId: 'principal-a',
        principalName: '  Alice  ',
        audience: 'public',
        bodyJson: null,
        bodyText: 'hi',
        sharedWithTeamId: null,
        createdAt: '2026-06-19T00:00:00.000Z',
        editedAt: null,
      },
      {
        id: 'thread-2',
        ticketId: 'ticket-1',
        principalId: 'principal-b',
        principalName: null,
        audience: 'internal',
        bodyJson: null,
        bodyText: 'note',
        sharedWithTeamId: null,
        createdAt: '2026-06-19T00:00:00.000Z',
        editedAt: null,
      },
      {
        id: 'thread-3',
        ticketId: 'ticket-1',
        principalId: null,
        principalName: 'System',
        audience: 'public',
        bodyJson: null,
        bodyText: 'system',
        sharedWithTeamId: null,
        createdAt: '2026-06-19T00:00:00.000Z',
        editedAt: null,
      },
    ],
    participants: [
      {
        id: 'p-1',
        ticketId: 'ticket-1',
        principalId: 'principal-a',
        contactId: null,
        role: 'agent',
      },
    ],
    shares: [{ id: 's-1', ticketId: 'ticket-1', teamId: 'team-shared', accessLevel: 'read' }],
    ...overrides,
  }
}

function renderPage() {
  const Component = routeOptions().component
  return render(<Component />)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.myPermissions = { data: undefined }
  mocks.getQueryData.mockReturnValue(undefined)
  seedQueries()
})

describe('admin ticket detail route — loader', () => {
  it('prefetches all five ticket queries', async () => {
    await routeOptions().loader({
      params: { ticketId: 'ticket-1' },
      context: { queryClient: { ensureQueryData: mocks.ensureQueryData } },
    })
    expect(mocks.ensureQueryData).toHaveBeenCalledTimes(5)
  })

  it('exposes the error component', () => {
    const ErrorComponent = routeOptions().errorComponent
    render(<ErrorComponent />)
    expect(screen.getByText('Failed to load ticket')).toBeInTheDocument()
  })
})

describe('admin ticket detail route — component (no permissions)', () => {
  it('renders read-only with all permissions denied and falls back currentPrincipalId to assignee', () => {
    renderPage()

    // perms.data undefined -> hasAnyPermission false for all three
    expect(screen.getByTestId('composer').textContent).toBe('false-false-false')
    // canEditDescription false -> feed is read-only
    expect(screen.getByTestId('can-edit').textContent).toBe('readonly')
    // currentPrincipalId falls back to assigneePrincipalId
    expect(screen.getByTestId('current-principal').textContent).toBe('principal-assignee')
    expect(screen.getByTestId('saving').textContent).toBe('false')
  })

  it('builds principalNames trimming names and skipping null principals', () => {
    renderPage()
    const names = JSON.parse(screen.getByTestId('principal-names').textContent ?? '{}')
    expect(names).toEqual({ 'principal-a': 'Alice', 'principal-b': 'Unknown' })
  })

  it('falls back currentPrincipalId to ticket.id when no assignee and no principal', () => {
    seedQueries({ detail: seedTicket({ assigneePrincipalId: null }) })
    renderPage()
    expect(screen.getByTestId('current-principal').textContent).toBe('ticket-1')
  })
})

describe('admin ticket detail route — component (workspace permissions)', () => {
  beforeEach(() => {
    mocks.myPermissions = {
      data: {
        principalId: 'principal-current',
        workspacePermissions: [
          'ticket.reply_public',
          'ticket.comment_internal',
          'ticket.share_cross_team',
          'ticket.edit_fields',
        ],
        teamPermissions: [],
      },
    }
  })

  it('grants all composer permissions and editable description via workspace scope', () => {
    renderPage()
    expect(screen.getByTestId('composer').textContent).toBe('true-true-true')
    expect(screen.getByTestId('can-edit').textContent).toBe('editable')
    expect(screen.getByTestId('shares').textContent).toBe('true')
    // currentPrincipalId now from perms
    expect(screen.getByTestId('current-principal').textContent).toBe('principal-current')
  })

  it('runs the description mutation success path and invalidates queries', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Update description' }))

    await waitFor(() =>
      expect(mocks.updateTicketFn).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ticketId: 'ticket-1',
          expectedUpdatedAt: '2026-06-19T00:00:00.000Z',
          descriptionText: 'new description text',
        }),
      })
    )
    expect(mocks.setQueryData).toHaveBeenCalled()
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Description updated')
    // invalidateTicket fires three invalidations
    expect(mocks.invalidateQueries).toHaveBeenCalledTimes(3)
  })

  it('uses cached updatedAt from queryClient for expectedUpdatedAt when present', async () => {
    mocks.getQueryData.mockReturnValue({ updatedAt: '2026-06-20T12:00:00.000Z' })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Update description' }))

    await waitFor(() =>
      expect(mocks.updateTicketFn).toHaveBeenCalledWith({
        data: expect.objectContaining({
          expectedUpdatedAt: '2026-06-20T12:00:00.000Z',
        }),
      })
    )
  })

  it('routes mutation errors to the conflict handler', async () => {
    mocks.updateTicketFn.mockRejectedValueOnce(new Error('stale'))
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Update description' }))

    await waitFor(() =>
      expect(mocks.handleTicketConflict).toHaveBeenCalledWith(
        expect.any(Error),
        expect.anything(),
        'ticket-1'
      )
    )
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })
})

describe('admin ticket detail route — component (team-scoped permissions)', () => {
  it('grants permission only when the team matches a ticket-related team', () => {
    mocks.myPermissions = {
      data: {
        principalId: 'principal-current',
        workspacePermissions: [],
        teamPermissions: [
          { teamId: 'team-primary', permissions: ['ticket.edit_fields', 'ticket.reply_public'] },
          // a team that holds the perm but is unrelated to this ticket -> no grant
          { teamId: 'team-unrelated', permissions: ['ticket.comment_internal'] },
        ],
      },
    }
    renderPage()
    // edit_fields granted because team-primary === ticket.primaryTeamId
    expect(screen.getByTestId('can-edit').textContent).toBe('editable')
    // reply_public granted via hasAnyPermission (team has the key, team-agnostic)
    // comment_internal granted via hasAnyPermission too (team-unrelated has it)
    expect(screen.getByTestId('composer').textContent).toBe('true-true-false')
  })

  it('denies resource permission when team holds key but is unrelated to ticket', () => {
    mocks.myPermissions = {
      data: {
        principalId: 'principal-current',
        workspacePermissions: [],
        teamPermissions: [{ teamId: 'team-unrelated', permissions: ['ticket.edit_fields'] }],
      },
    }
    renderPage()
    // edit_fields denied -> read-only because team-unrelated is not primary/assignee/shared
    expect(screen.getByTestId('can-edit').textContent).toBe('readonly')
  })

  it('grants resource permission via the shared team id', () => {
    mocks.myPermissions = {
      data: {
        principalId: 'principal-current',
        workspacePermissions: [],
        teamPermissions: [{ teamId: 'team-shared', permissions: ['ticket.edit_fields'] }],
      },
    }
    renderPage()
    expect(screen.getByTestId('can-edit').textContent).toBe('editable')
  })
})
