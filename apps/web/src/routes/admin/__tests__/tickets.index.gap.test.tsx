// @vitest-environment happy-dom
import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

type RouteOptions = {
  loaderDeps: (input: { search: Record<string, unknown> }) => Record<string, unknown>
  loader: (input: {
    deps: Record<string, unknown>
    context: { queryClient: { ensureQueryData: (query: unknown) => unknown } }
  }) => Promise<unknown>
  component: () => ReactElement
  pendingComponent: () => ReactElement
  errorComponent: () => ReactElement
}

type ComponentProps = {
  children?: ReactNode
  className?: string
}

const mocks = vi.hoisted(() => ({
  ensureQueryData: vi.fn(async () => undefined),
  navigate: vi.fn(),
  search: {} as Record<string, unknown>,
  listData: {} as { total: number; rows: unknown[] },
  statusesData: [] as unknown[],
  lastListParams: undefined as unknown,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useSearch: () => mocks.search,
    useNavigate: () => mocks.navigate,
  }),
}))

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: (query: { queryKey: readonly unknown[] }) => ({
    data: query.queryKey[1] === 'statuses' ? mocks.statusesData : mocks.listData,
  }),
}))

vi.mock('@/components/admin/shared', () => ({
  createRouteErrorComponent: (message: string) => () => <div>{message}</div>,
}))

vi.mock('@/lib/client/queries/tickets', () => ({
  ticketQueries: {
    list: (params: unknown) => {
      mocks.lastListParams = params
      return { queryKey: ['tickets', 'list', params] }
    },
    statuses: () => ({ queryKey: ['tickets', 'statuses'] }),
  },
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: Record<string, unknown>) => <input {...(props as object)} />,
}))

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <span data-testid="skeleton" className={className} />
  ),
}))

vi.mock('@/lib/shared/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

vi.mock('@/components/admin/tickets/ticket-queue-table', () => ({
  TicketQueueTable: ({
    rows,
    statuses,
    invalidateKey,
  }: {
    rows: unknown[]
    statuses: unknown[]
    invalidateKey: unknown
  } & ComponentProps) => (
    <div data-testid="queue-table">
      <span data-testid="rows">{JSON.stringify(rows)}</span>
      <span data-testid="statuses">{JSON.stringify(statuses)}</span>
      <span data-testid="invalidate-key">{JSON.stringify(invalidateKey)}</span>
    </div>
  ),
}))

const { Route } = await import('../tickets.index')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

function renderPage() {
  const Component = routeOptions().component
  return render(<Component />)
}

function seedListData(overrides: Partial<{ total: number; rows: unknown[] }> = {}) {
  mocks.listData = {
    total: 2,
    rows: [
      {
        id: 'ticket-1',
        subject: 'First',
        statusId: 'status-1',
        priority: 'high',
        channel: 'email',
        lastActivityAt: '2026-06-20T00:00:00.000Z',
        assigneePrincipalId: 'principal-1',
      },
      {
        id: 'ticket-2',
        subject: 'Second',
        statusId: 'status-2',
        priority: 'low',
        channel: 'web',
        lastActivityAt: '2026-06-19T00:00:00.000Z',
        assigneePrincipalId: null,
      },
    ],
    ...overrides,
  }
  mocks.statusesData = [
    { id: 'status-1', name: 'Open', category: 'open' },
    { id: 'status-2', name: 'Closed', category: 'closed' },
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.search = {}
  mocks.lastListParams = undefined
  seedListData()
})

describe('admin tickets index route — loader & deps', () => {
  it('loaderDeps extracts search fields', () => {
    const deps = routeOptions().loaderDeps({
      search: {
        scope: 'all',
        statusCategory: 'open',
        search: 'bug',
        inboxId: 'inbox-1',
        sort: 'newest',
      },
    })
    expect(deps).toEqual({
      scope: 'all',
      statusCategory: 'open',
      search: 'bug',
      inboxId: 'inbox-1',
      sort: 'newest',
    })
  })

  it('loader prefetches list and statuses with provided deps', async () => {
    await routeOptions().loader({
      deps: {
        scope: 'all',
        statusCategory: 'open',
        search: 'x',
        inboxId: 'inbox-1',
        sort: 'newest',
      },
      context: { queryClient: { ensureQueryData: mocks.ensureQueryData } },
    })
    expect(mocks.ensureQueryData).toHaveBeenCalledTimes(2)
    expect(mocks.lastListParams).toEqual({
      scope: 'all',
      statusCategory: 'open',
      search: 'x',
      inboxId: 'inbox-1',
      sort: 'newest',
    })
  })

  it('loader applies defaults for missing scope and inboxId', async () => {
    await routeOptions().loader({
      deps: {},
      context: { queryClient: { ensureQueryData: mocks.ensureQueryData } },
    })
    expect(mocks.lastListParams).toEqual({
      scope: 'my_assigned',
      statusCategory: undefined,
      search: undefined,
      inboxId: null,
      sort: undefined,
    })
  })

  it('exposes the error component', () => {
    const ErrorComponent = routeOptions().errorComponent
    render(<ErrorComponent />)
    expect(screen.getByText('Failed to load tickets')).toBeInTheDocument()
  })

  it('renders the pending component skeletons', () => {
    const Pending = routeOptions().pendingComponent
    render(<Pending />)
    expect(screen.getAllByTestId('skeleton')).toHaveLength(6)
  })
})

describe('admin tickets index route — component', () => {
  it('renders the queue table with mapped rows and statuses', () => {
    renderPage()
    const rows = JSON.parse(screen.getByTestId('rows').textContent ?? '[]')
    expect(rows).toEqual([
      {
        id: 'ticket-1',
        subject: 'First',
        statusId: 'status-1',
        priority: 'high',
        channel: 'email',
        lastActivityAt: '2026-06-20T00:00:00.000Z',
        assigneePrincipalId: 'principal-1',
      },
      {
        id: 'ticket-2',
        subject: 'Second',
        statusId: 'status-2',
        priority: 'low',
        channel: 'web',
        lastActivityAt: '2026-06-19T00:00:00.000Z',
        assigneePrincipalId: null,
      },
    ])
    const statuses = JSON.parse(screen.getByTestId('statuses').textContent ?? '[]')
    expect(statuses).toEqual([
      { id: 'status-1', name: 'Open', category: 'open' },
      { id: 'status-2', name: 'Closed', category: 'closed' },
    ])
  })

  it('renders pluralized ticket count', () => {
    renderPage()
    expect(screen.getByText('2 tickets')).toBeInTheDocument()
  })

  it('renders singular ticket count when total is 1', () => {
    seedListData({ total: 1, rows: [mocks.listData.rows[0]] })
    renderPage()
    expect(screen.getByText('1 ticket')).toBeInTheDocument()
  })

  it('initializes search input from search.search', () => {
    mocks.search = { search: 'preset' }
    renderPage()
    expect(screen.getByPlaceholderText('Search subject…')).toHaveValue('preset')
  })

  it('navigates on Enter with the typed search value', () => {
    renderPage()
    const input = screen.getByPlaceholderText('Search subject…') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'crash' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mocks.navigate).toHaveBeenCalledTimes(1)
    const updater = mocks.navigate.mock.calls[0][0].search
    expect(updater({ scope: 'all' })).toEqual({ scope: 'all', search: 'crash' })
  })

  it('navigates with undefined search when input is empty', () => {
    renderPage()
    const input = screen.getByPlaceholderText('Search subject…')
    fireEvent.keyDown(input, { key: 'Enter' })
    const updater = mocks.navigate.mock.calls[0][0].search
    expect(updater({ scope: 'all' })).toEqual({ scope: 'all', search: undefined })
  })

  it('does not navigate on non-Enter keys', () => {
    renderPage()
    const input = screen.getByPlaceholderText('Search subject…')
    fireEvent.keyDown(input, { key: 'a' })
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('activates a status category filter when none is active', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    const updater = mocks.navigate.mock.calls[0][0].search
    expect(updater({ scope: 'all' })).toEqual({ scope: 'all', statusCategory: 'open' })
  })

  it('clears the active status category when its button is clicked again', () => {
    mocks.search = { statusCategory: 'pending' }
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'pending' }))
    const updater = mocks.navigate.mock.calls[0][0].search
    expect(updater({ scope: 'all', statusCategory: 'pending' })).toEqual({
      scope: 'all',
      statusCategory: undefined,
    })
  })

  it('renders the on_hold category label with a space', () => {
    renderPage()
    expect(screen.getByRole('button', { name: 'on hold' })).toBeInTheDocument()
  })

  it('passes the list query key as the table invalidateKey', () => {
    renderPage()
    const key = JSON.parse(screen.getByTestId('invalidate-key').textContent ?? '[]')
    expect(key[0]).toBe('tickets')
    expect(key[1]).toBe('list')
  })
})
