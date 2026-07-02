// @vitest-environment happy-dom
import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

type RouteOptions = {
  loader: (input: {
    context: { queryClient: { ensureQueryData: (query: unknown) => unknown } }
  }) => Promise<unknown>
  component: () => ReactElement
  errorComponent: () => ReactElement
}

type ComponentProps = {
  children?: ReactNode
  className?: string
}

const mocks = vi.hoisted(() => ({
  ensureQueryData: vi.fn(async () => undefined),
  listQuery: vi.fn((filters: { includeArchived?: boolean }) => ({
    queryKey: ['inboxes', 'list', filters],
  })),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}))

vi.mock('@/components/admin/shared', () => ({
  createRouteErrorComponent: (message: string) => () => <div>{message}</div>,
}))

vi.mock('@/lib/client/queries/inboxes', () => ({
  inboxQueries: {
    list: mocks.listQuery,
  },
}))

vi.mock('@/components/admin/settings/inboxes/inbox-list', () => ({
  InboxList: () => <div data-testid="inbox-list" />,
}))

vi.mock('@/components/admin/settings/inboxes/inbox-create-dialog', () => ({
  InboxCreateDialog: ({ trigger }: { trigger: ReactNode }) => (
    <div data-testid="create-dialog">{trigger}</div>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children }: ComponentProps) => <button type="button">{children}</button>,
}))

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => <span className={className} />,
}))

vi.mock('@heroicons/react/24/solid', () => ({
  PlusIcon: () => <span />,
}))

const { Route } = await import('../settings.inboxes')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('admin settings.inboxes route — loader', () => {
  it('prefetches the inbox list including archived', async () => {
    await routeOptions().loader({
      context: { queryClient: { ensureQueryData: mocks.ensureQueryData } },
    })
    expect(mocks.listQuery).toHaveBeenCalledWith({ includeArchived: true })
    expect(mocks.ensureQueryData).toHaveBeenCalledTimes(1)
    expect(mocks.ensureQueryData).toHaveBeenCalledWith({
      queryKey: ['inboxes', 'list', { includeArchived: true }],
    })
  })

  it('exposes the error component', () => {
    const ErrorComponent = routeOptions().errorComponent
    render(<ErrorComponent />)
    expect(screen.getByText('Failed to load inboxes')).toBeInTheDocument()
  })
})

describe('admin settings.inboxes route — component', () => {
  it('renders the header, create dialog trigger, and inbox list', () => {
    const Component = routeOptions().component
    render(<Component />)
    expect(screen.getByText('Inboxes')).toBeInTheDocument()
    expect(
      screen.getByText('Named queues with channels, members, and routing defaults.')
    ).toBeInTheDocument()
    expect(screen.getByText('New inbox')).toBeInTheDocument()
    expect(screen.getByTestId('create-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('inbox-list')).toBeInTheDocument()
  })
})
