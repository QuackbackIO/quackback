// @vitest-environment happy-dom
import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

type RouteOptions = {
  loader: (input: {
    params: { teamId: string }
    context: { queryClient: { ensureQueryData: (query: unknown) => unknown } }
  }) => Promise<unknown>
  component: () => ReactElement
  errorComponent: () => ReactElement
}

type ComponentProps = {
  children?: ReactNode
  className?: string
  to?: string
}

const mocks = vi.hoisted(() => ({
  ensureQueryData: vi.fn(async () => undefined),
  notFound: vi.fn(() => new Error('not-found')),
  queryData: {} as Record<string, unknown>,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useParams: () => ({ teamId: 'team-1' }),
  }),
  Link: ({ children, to }: ComponentProps) => <a href={to}>{children}</a>,
  notFound: mocks.notFound,
}))

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: (query: { queryKey: readonly unknown[] }) => ({
    data: mocks.queryData[query.queryKey[1] as string],
  }),
}))

vi.mock('@/components/admin/shared', () => ({
  createRouteErrorComponent: (message: string) => () => <div>{message}</div>,
}))

vi.mock('@/lib/client/queries/teams', () => ({
  teamQueries: {
    detail: (teamId: string) => ({ queryKey: ['teams', 'detail', teamId] }),
    members: (teamId: string) => ({ queryKey: ['teams', 'members', teamId] }),
  },
}))

vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: ComponentProps) => <div>{children}</div>,
  TabsList: ({ children }: ComponentProps) => <div>{children}</div>,
  TabsTrigger: ({ children }: ComponentProps) => <button type="button">{children}</button>,
  TabsContent: ({ children }: ComponentProps) => <div>{children}</div>,
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: ComponentProps) => <span data-testid="badge">{children}</span>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children }: ComponentProps) => <span>{children}</span>,
}))

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => <span className={className} />,
}))

vi.mock('@heroicons/react/24/outline', () => ({
  ArrowLeftIcon: ({ className }: { className?: string }) => <span className={className} />,
}))

vi.mock('@/components/admin/settings/teams/team-overview-tab', () => ({
  TeamOverviewTab: ({ team }: { team: { id: string } }) => (
    <div data-testid="overview">{team.id}</div>
  ),
}))

vi.mock('@/components/admin/settings/teams/team-members-tab', () => ({
  TeamMembersTab: ({ teamId }: { teamId: string }) => <div data-testid="members">{teamId}</div>,
}))

const { Route } = await import('../settings.teams_.$teamId')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

function seedTeam(overrides: Record<string, unknown> = {}) {
  return {
    id: 'team-1',
    name: 'Support',
    slug: 'support',
    shortLabel: 'SUP',
    color: '#123456',
    description: 'Front-line support team',
    archivedAt: null,
    ...overrides,
  }
}

function renderPage() {
  const Component = routeOptions().component
  return render(<Component />)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.queryData = { detail: seedTeam(), members: [] }
})

describe('admin team detail route — loader', () => {
  it('prefetches detail and members queries when detail exists', async () => {
    mocks.ensureQueryData.mockResolvedValue(seedTeam() as never)
    await routeOptions().loader({
      params: { teamId: 'team-1' },
      context: { queryClient: { ensureQueryData: mocks.ensureQueryData } },
    })
    expect(mocks.ensureQueryData).toHaveBeenCalledTimes(2)
    expect(mocks.notFound).not.toHaveBeenCalled()
  })

  it('throws notFound when detail is missing', async () => {
    mocks.ensureQueryData.mockResolvedValue(undefined)
    await expect(
      routeOptions().loader({
        params: { teamId: 'team-1' },
        context: { queryClient: { ensureQueryData: mocks.ensureQueryData } },
      })
    ).rejects.toThrow()
    expect(mocks.notFound).toHaveBeenCalled()
  })

  it('exposes the error component', () => {
    const ErrorComponent = routeOptions().errorComponent
    render(<ErrorComponent />)
    expect(screen.getByText('Failed to load team')).toBeInTheDocument()
  })
})

describe('admin team detail route — component', () => {
  it('returns null when team data is absent', () => {
    mocks.queryData = { detail: undefined, members: [] }
    const { container } = renderPage()
    expect(container.firstChild).toBeNull()
  })

  it('renders header, short label, description, and the Active badge', () => {
    renderPage()
    expect(screen.getByText('Support')).toBeInTheDocument()
    expect(screen.getByText('support')).toBeInTheDocument()
    expect(screen.getByText('SUP')).toBeInTheDocument()
    expect(screen.getByText('Front-line support team')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByTestId('overview').textContent).toBe('team-1')
    expect(screen.getByTestId('members').textContent).toBe('team-1')
  })

  it('shows the Archived badge and falls back color when team is archived', () => {
    mocks.queryData = {
      detail: seedTeam({ archivedAt: '2026-01-01T00:00:00.000Z', color: null }),
      members: [],
    }
    renderPage()
    expect(screen.getByText('Archived')).toBeInTheDocument()
  })

  it('omits the short label and description when not provided', () => {
    mocks.queryData = {
      detail: seedTeam({ shortLabel: null, description: null }),
      members: [],
    }
    renderPage()
    expect(screen.queryByText('SUP')).not.toBeInTheDocument()
    expect(screen.queryByText('Front-line support team')).not.toBeInTheDocument()
  })
})
