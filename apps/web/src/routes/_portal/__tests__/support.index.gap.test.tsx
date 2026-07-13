// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type RouteOptions = {
  beforeLoad: (input: { context: Record<string, unknown> }) => Promise<void>
}

const mocks = vi.hoisted(() => ({
  getSupportSurfaceAccessFn: vi.fn(async () => ({ granted: true })),
  getMyConversationsFn: vi.fn(async () => ({ conversations: [] })),
  useQuery: vi.fn(() => ({ data: { conversations: [] }, isLoading: false })),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
  Navigate: () => <div data-testid="navigate" />,
  useRouteContext: () => ({ session: null, settings: {} }),
  redirect: (input: unknown) => {
    throw { redirect: input }
  },
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: mocks.useQuery,
}))

vi.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ defaultMessage }: { defaultMessage: string }) => defaultMessage,
  }),
  FormattedMessage: ({ defaultMessage }: { defaultMessage: string }) => <>{defaultMessage}</>,
}))

vi.mock('@heroicons/react/24/outline', () => ({
  ChatBubbleLeftRightIcon: () => <svg />,
  ChevronRightIcon: () => <svg />,
  PlusIcon: () => <svg />,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/shared/empty-state', () => ({
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
}))

vi.mock('@/components/shared/spinner', () => ({
  Spinner: () => <div data-testid="spinner" />,
}))

vi.mock('@/components/ui/time-ago', () => ({
  TimeAgo: () => <span />,
}))

vi.mock('@/components/auth/auth-popover-context', () => ({
  useAuthPopoverSafe: () => null,
}))

vi.mock('@/lib/server/functions/chat', () => ({
  getMyConversationsFn: mocks.getMyConversationsFn,
  getSupportSurfaceAccessFn: mocks.getSupportSurfaceAccessFn,
}))

vi.mock('@/lib/client/queries/portal-support', () => ({
  PORTAL_MY_CONVERSATIONS_QUERY_KEY: ['portal', 'my-conversations'],
}))

const { Route } = await import('../support.index')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSupportSurfaceAccessFn.mockResolvedValue({ granted: true })
})

describe('portal support index route — beforeLoad', () => {
  it('redirects when the support tab is disabled', async () => {
    await expect(
      routeOptions().beforeLoad({ context: { enabledTabs: { support: false } } })
    ).rejects.toEqual({ redirect: { to: '/' } })
    expect(mocks.getSupportSurfaceAccessFn).not.toHaveBeenCalled()
  })

  it('redirects when surface access is not granted', async () => {
    mocks.getSupportSurfaceAccessFn.mockResolvedValueOnce({ granted: false })
    await expect(routeOptions().beforeLoad({ context: {} })).rejects.toEqual({
      redirect: { to: '/' },
    })
    expect(mocks.getSupportSurfaceAccessFn).toHaveBeenCalledWith({ data: { surface: 'portal' } })
  })

  it('allows access when the tab is enabled and access is granted', async () => {
    await expect(
      routeOptions().beforeLoad({ context: { enabledTabs: { support: true } } })
    ).resolves.toBeUndefined()
  })

  it('exercises the query function passed to useQuery', async () => {
    // Render the component so useQuery (and its queryFn) is wired up.
    const Component = (Route.options as unknown as { component: () => React.ReactElement })
      .component
    const { render } = await import('@testing-library/react')
    render(<Component />)

    const options = (mocks.useQuery.mock.calls[0] as unknown[])?.[0] as
      | { queryFn: () => Promise<unknown> }
      | undefined
    expect(options).toBeDefined()
    await options!.queryFn()
    expect(mocks.getMyConversationsFn).toHaveBeenCalledWith({ data: { surface: 'portal' } })
  })
})
