// @vitest-environment happy-dom
import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

type RouteOptions = {
  loader: (input: {
    params: { inboxId: string }
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
    useParams: () => ({ inboxId: 'inbox-1' }),
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

vi.mock('@/lib/client/queries/inboxes', () => ({
  inboxQueries: {
    detail: (inboxId: string) => ({ queryKey: ['inboxes', 'detail', inboxId] }),
    channels: (inboxId: string) => ({ queryKey: ['inboxes', 'channels', inboxId] }),
    memberships: (inboxId: string) => ({ queryKey: ['inboxes', 'memberships', inboxId] }),
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

vi.mock('@/components/admin/settings/inboxes/inbox-overview-tab', () => ({
  InboxOverviewTab: ({ inbox }: { inbox: { id: string } }) => (
    <div data-testid="overview">{inbox.id}</div>
  ),
}))

vi.mock('@/components/admin/settings/inboxes/inbox-channels-tab', () => ({
  InboxChannelsTab: ({ inboxId }: { inboxId: string }) => (
    <div data-testid="channels">{inboxId}</div>
  ),
}))

vi.mock('@/components/admin/settings/inboxes/inbox-members-tab', () => ({
  InboxMembersTab: ({ inboxId }: { inboxId: string }) => <div data-testid="members">{inboxId}</div>,
}))

const { Route } = await import('../settings.inboxes_.$inboxId')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

function seedInbox(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inbox-1',
    name: 'Support Inbox',
    slug: 'support',
    description: 'Main support inbox',
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
  mocks.queryData = { detail: seedInbox(), channels: [], memberships: [] }
})

describe('admin inbox detail route — loader', () => {
  it('prefetches detail, channels and memberships queries when detail exists', async () => {
    mocks.ensureQueryData.mockResolvedValue(seedInbox() as never)
    await routeOptions().loader({
      params: { inboxId: 'inbox-1' },
      context: { queryClient: { ensureQueryData: mocks.ensureQueryData } },
    })
    expect(mocks.ensureQueryData).toHaveBeenCalledTimes(3)
    expect(mocks.notFound).not.toHaveBeenCalled()
  })

  it('throws notFound when detail is missing', async () => {
    mocks.ensureQueryData.mockResolvedValue(undefined)
    await expect(
      routeOptions().loader({
        params: { inboxId: 'inbox-1' },
        context: { queryClient: { ensureQueryData: mocks.ensureQueryData } },
      })
    ).rejects.toThrow()
    expect(mocks.notFound).toHaveBeenCalled()
  })

  it('exposes the error component', () => {
    const ErrorComponent = routeOptions().errorComponent
    render(<ErrorComponent />)
    expect(screen.getByText('Failed to load inbox')).toBeInTheDocument()
  })
})

describe('admin inbox detail route — component', () => {
  it('returns null when inbox data is absent', () => {
    mocks.queryData = { detail: undefined, channels: [], memberships: [] }
    const { container } = renderPage()
    expect(container.firstChild).toBeNull()
  })

  it('renders header, slug, description, and the Active badge', () => {
    renderPage()
    expect(screen.getByText('Support Inbox')).toBeInTheDocument()
    expect(screen.getByText('support')).toBeInTheDocument()
    expect(screen.getByText('Main support inbox')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByTestId('overview').textContent).toBe('inbox-1')
    expect(screen.getByTestId('channels').textContent).toBe('inbox-1')
    expect(screen.getByTestId('members').textContent).toBe('inbox-1')
  })

  it('shows the Archived badge when inbox is archived', () => {
    mocks.queryData = {
      detail: seedInbox({ archivedAt: '2026-01-01T00:00:00.000Z' }),
      channels: [],
      memberships: [],
    }
    renderPage()
    expect(screen.getByText('Archived')).toBeInTheDocument()
  })

  it('omits the description when not provided', () => {
    mocks.queryData = {
      detail: seedInbox({ description: null }),
      channels: [],
      memberships: [],
    }
    renderPage()
    expect(screen.queryByText('Main support inbox')).not.toBeInTheDocument()
  })
})
