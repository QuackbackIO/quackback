// @vitest-environment happy-dom
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

type RouteOptions = {
  loader: (input: {
    context: { queryClient: { ensureQueryData: (query: unknown) => unknown } }
  }) => Promise<unknown>
  component: () => ReactElement
  errorComponent: () => ReactElement
}

const mocks = vi.hoisted(() => ({
  ensureQueryData: vi.fn(async () => undefined),
  listRolesFn: vi.fn(async () => [{ id: 'role_1', name: 'Admin' }]),
  useSuspenseQuery: vi.fn(() => ({ data: [{ id: 'role_1', name: 'Admin' }] })),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}))

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: mocks.useSuspenseQuery,
}))

vi.mock('@/components/admin/shared', () => ({
  createRouteErrorComponent: (message: string) => () => <div>{message}</div>,
}))

vi.mock('@/lib/server/functions/roles', () => ({
  listRolesFn: mocks.listRolesFn,
}))

vi.mock('@/components/admin/settings/roles/roles-settings', () => ({
  RolesSettings: ({ roles }: { roles: unknown }) => (
    <div data-testid="roles-settings" data-roles={JSON.stringify(roles)} />
  ),
}))

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => <span className={className} />,
}))

const { Route } = await import('../settings.roles')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useSuspenseQuery.mockReturnValue({ data: [{ id: 'role_1', name: 'Admin' }] })
})

describe('admin settings.roles route — loader/query', () => {
  it('prefetches the roles list and the query fn calls listRolesFn', async () => {
    await routeOptions().loader({
      context: { queryClient: { ensureQueryData: mocks.ensureQueryData } },
    })
    expect(mocks.ensureQueryData).toHaveBeenCalledTimes(1)
    const query = (mocks.ensureQueryData.mock.calls[0] as unknown[])[0] as unknown as {
      queryKey: readonly string[]
      queryFn: () => unknown
    }
    expect(query.queryKey).toEqual(['admin', 'roles', 'list'])
    query.queryFn()
    expect(mocks.listRolesFn).toHaveBeenCalledTimes(1)
  })

  it('exposes the error component', () => {
    const ErrorComponent = routeOptions().errorComponent
    render(<ErrorComponent />)
    expect(screen.getByText('Failed to load roles')).toBeInTheDocument()
  })
})

describe('admin settings.roles route — component', () => {
  it('renders header and forwards suspense data into RolesSettings', () => {
    const Component = routeOptions().component
    render(<Component />)
    expect(screen.getByText('Roles & permissions')).toBeInTheDocument()
    const settings = screen.getByTestId('roles-settings')
    expect(settings.getAttribute('data-roles')).toBe(
      JSON.stringify([{ id: 'role_1', name: 'Admin' }])
    )
    expect(mocks.useSuspenseQuery).toHaveBeenCalled()
  })
})
