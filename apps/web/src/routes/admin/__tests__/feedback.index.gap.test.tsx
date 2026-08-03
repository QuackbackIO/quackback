// @vitest-environment happy-dom
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

type LoaderFn = (input: {
  deps: Record<string, unknown>
  context: {
    user: { name: string; email: string }
    principal: { id: string }
    queryClient: { prefetchQuery: (q: unknown) => Promise<unknown> }
  }
}) => Promise<{ currentUser: { name: string; email: string; principalId: string } }>

type RouteOptions = {
  loaderDeps: (input: { search: Record<string, unknown> }) => Record<string, unknown>
  loader: LoaderFn
  component: () => ReactElement
  errorComponent: (props: { error: Error; reset: () => void }) => ReactElement
}

const mocks = vi.hoisted(() => ({
  prefetchQuery: vi.fn(async () => undefined),
  inboxPosts: vi.fn((p: unknown) => ({ queryKey: ['admin', 'inboxPosts', p] })),
  boards: vi.fn(() => ({ queryKey: ['admin', 'boards'] })),
  tags: vi.fn(() => ({ queryKey: ['admin', 'tags'] })),
  statuses: vi.fn(() => ({ queryKey: ['admin', 'statuses'] })),
  teamMembers: vi.fn(() => ({ queryKey: ['admin', 'teamMembers'] })),
  moderationStatus: vi.fn(() => ({ queryKey: ['admin', 'moderationStatus'] })),
  mergeSummary: vi.fn(() => ({ queryKey: ['signals', 'merge-summary'] })),
  loaderData: { name: 'Demo', email: 'demo@example.com', principalId: 'principal_1' },
  search: {} as Record<string, unknown>,
  inboxData: { posts: [{ id: 'p1' }] },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}))

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: vi.fn(() => ({ data: mocks.inboxData })),
  useQuery: vi.fn(() => ({ data: [] })),
}))

vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    inboxPosts: mocks.inboxPosts,
    boards: mocks.boards,
    tags: mocks.tags,
    statuses: mocks.statuses,
    teamMembers: mocks.teamMembers,
    moderationStatus: mocks.moderationStatus,
  },
}))

vi.mock('@/lib/client/queries/signals', () => ({
  mergeSuggestionQueries: {
    summary: mocks.mergeSummary,
  },
}))

vi.mock('@/components/admin/feedback/inbox-container', () => ({
  InboxContainer: (props: Record<string, unknown>) => (
    <div data-testid="inbox" data-name={(props.currentUser as { name: string }).name} />
  ),
}))

vi.mock('@/components/ui/alert', () => ({
  Alert: ({ children }: { children?: unknown }) => <div>{children as ReactElement}</div>,
  AlertDescription: ({ children }: { children?: unknown }) => <div>{children as ReactElement}</div>,
  AlertTitle: ({ children }: { children?: unknown }) => <div>{children as ReactElement}</div>,
}))

vi.mock('@heroicons/react/24/solid', () => ({
  ExclamationCircleIcon: () => <span />,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick }: { children?: unknown; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children as ReactElement}
    </button>
  ),
}))

const { Route } = await import('../feedback.index')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

// Stub the route helpers the component relies on.
;(Route as unknown as { useLoaderData: () => unknown }).useLoaderData = () => ({
  currentUser: mocks.loaderData,
})
;(Route as unknown as { useSearch: () => unknown }).useSearch = () => mocks.search

beforeEach(() => {
  vi.clearAllMocks()
  mocks.search = {}
})

describe('admin feedback.index route — loader', () => {
  it('prefetches all admin queries in parallel with parsed filters', async () => {
    const result = await routeOptions().loader({
      deps: {
        board: ['board_1'],
        tags: ['tag_1'],
        status: ['open'],
        owner: 'unassigned',
        minVotes: '5',
        search: 'bug',
        deleted: true,
      },
      context: {
        user: { name: 'Demo', email: 'demo@example.com' },
        principal: { id: 'principal_1' },
        queryClient: { prefetchQuery: mocks.prefetchQuery },
      },
    })

    expect(mocks.prefetchQuery).toHaveBeenCalledTimes(7)
    expect(mocks.inboxPosts).toHaveBeenCalledWith(
      expect.objectContaining({
        boardIds: ['board_1'],
        statusSlugs: ['open'],
        tagIds: ['tag_1'],
        ownerId: null,
        minVotes: 5,
        showDeleted: true,
        limit: 20,
      })
    )
    expect(mocks.boards).toHaveBeenCalled()
    expect(mocks.tags).toHaveBeenCalled()
    expect(mocks.statuses).toHaveBeenCalled()
    expect(mocks.teamMembers).toHaveBeenCalled()
    expect(mocks.mergeSummary).toHaveBeenCalled()
    expect(mocks.moderationStatus).toHaveBeenCalled()
    expect(result).toEqual({
      currentUser: { name: 'Demo', email: 'demo@example.com', principalId: 'principal_1' },
    })
  })

  it('passes an owner id through (non-unassigned branch) and omits empty filters', async () => {
    await routeOptions().loader({
      deps: { owner: 'principal_99' },
      context: {
        user: { name: 'Demo', email: 'demo@example.com' },
        principal: { id: 'principal_1' },
        queryClient: { prefetchQuery: mocks.prefetchQuery },
      },
    })
    expect(mocks.inboxPosts).toHaveBeenCalledWith(
      expect.objectContaining({
        boardIds: undefined,
        statusSlugs: undefined,
        tagIds: undefined,
        ownerId: 'principal_99',
        minVotes: undefined,
        showDeleted: undefined,
      })
    )
  })
})

describe('admin feedback.index route — error component', () => {
  it('renders the message and a working reset button', () => {
    const reset = vi.fn()
    const ErrorComponent = routeOptions().errorComponent
    render(<ErrorComponent error={new Error('boom')} reset={reset} />)
    expect(screen.getByText('Failed to load feedback')).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()
    screen.getByText('Try again').click()
    expect(reset).toHaveBeenCalled()
  })
})

describe('admin feedback.index route — component', () => {
  it('renders the inbox container with current user and queries the boards/tags/statuses/members', () => {
    const Component = routeOptions().component
    render(<Component />)
    expect(screen.getByTestId('inbox').getAttribute('data-name')).toBe('Demo')
    expect(mocks.boards).toHaveBeenCalled()
    expect(mocks.tags).toHaveBeenCalled()
    expect(mocks.statuses).toHaveBeenCalled()
    expect(mocks.teamMembers).toHaveBeenCalled()
  })
})
