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
    queryKey: ['teams', 'list', filters],
  })),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}))

vi.mock('@/components/admin/shared', () => ({
  createRouteErrorComponent: (message: string) => () => <div>{message}</div>,
}))

vi.mock('@/lib/client/queries/teams', () => ({
  teamQueries: {
    list: mocks.listQuery,
  },
}))

vi.mock('@/components/admin/settings/teams/team-list', () => ({
  TeamList: () => <div data-testid="team-list" />,
}))

vi.mock('@/components/admin/settings/teams/team-create-dialog', () => ({
  TeamCreateDialog: ({ trigger }: { trigger: ReactNode }) => (
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

vi.mock('@/components/admin/shared/permission-gate', () => ({
  PermissionGate: ({ children }: ComponentProps) => <div data-testid="gate">{children}</div>,
}))

vi.mock('@/lib/server/domains/authz', () => ({
  PERMISSIONS: {
    ADMIN_MANAGE_USERS: 'admin.manage_users',
  },
}))

const { Route } = await import('../settings.teams')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('admin settings.teams route — loader', () => {
  it('prefetches the team list including archived teams', async () => {
    await routeOptions().loader({
      context: { queryClient: { ensureQueryData: mocks.ensureQueryData } },
    })
    expect(mocks.listQuery).toHaveBeenCalledWith({ includeArchived: true })
    expect(mocks.ensureQueryData).toHaveBeenCalledTimes(1)
    expect(mocks.ensureQueryData).toHaveBeenCalledWith({
      queryKey: ['teams', 'list', { includeArchived: true }],
    })
  })

  it('exposes the error component', () => {
    const ErrorComponent = routeOptions().errorComponent
    render(<ErrorComponent />)
    expect(screen.getByText('Failed to load teams')).toBeInTheDocument()
  })
})

describe('admin settings.teams route — component', () => {
  it('renders the header, gated create dialog, and team list', () => {
    const Component = routeOptions().component
    render(<Component />)
    expect(screen.getByText('Teams')).toBeInTheDocument()
    expect(
      screen.getByText('Workspace teams used for routing, ticket sharing, and SLA scopes.')
    ).toBeInTheDocument()
    expect(screen.getByText('New team')).toBeInTheDocument()
    expect(screen.getByTestId('gate')).toBeInTheDocument()
    expect(screen.getByTestId('create-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('team-list')).toBeInTheDocument()
  })
})
