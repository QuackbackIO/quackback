// @vitest-environment happy-dom
import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

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
  onClick?: () => void
}

const mocks = vi.hoisted(() => ({
  ensureQueryData: vi.fn(async () => undefined),
  policiesQuery: vi.fn((params: { includeArchived?: boolean }) => ({
    queryKey: ['sla', 'policies', params],
  })),
  bhListQuery: vi.fn((params: Record<string, unknown>) => ({
    queryKey: ['business-hours', 'list', params],
  })),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}))

vi.mock('@/components/admin/shared', () => ({
  createRouteErrorComponent: (message: string) => () => <div>{message}</div>,
}))

vi.mock('@/lib/client/queries/sla', () => ({
  slaQueries: {
    policies: mocks.policiesQuery,
  },
}))

vi.mock('@/lib/client/queries/business-hours', () => ({
  businessHoursQueries: {
    list: mocks.bhListQuery,
  },
}))

vi.mock('@/components/admin/settings/sla/sla-policy-list', () => ({
  SlaPolicyList: () => <div data-testid="sla-list" />,
}))

vi.mock('@/components/admin/settings/sla/sla-policy-create-dialog', () => ({
  SlaPolicyCreateDialog: ({ open }: { open: boolean; onOpenChange: (open: boolean) => void }) => (
    <div data-testid="sla-create-dialog" data-open={String(open)} />
  ),
}))

vi.mock('@/components/admin/settings/sla/sla-tick-trigger', () => ({
  SlaTickTrigger: () => <div data-testid="sla-tick" />,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick }: ComponentProps) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
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
    SLA_MANAGE: 'sla.manage',
  },
}))

const { Route } = await import('../settings.sla')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('admin settings.sla route — loader', () => {
  it('prefetches policies (including archived) and the business-hours list', async () => {
    await routeOptions().loader({
      context: { queryClient: { ensureQueryData: mocks.ensureQueryData } },
    })
    expect(mocks.policiesQuery).toHaveBeenCalledWith({ includeArchived: true })
    expect(mocks.bhListQuery).toHaveBeenCalledWith({})
    expect(mocks.ensureQueryData).toHaveBeenCalledTimes(2)
    expect(mocks.ensureQueryData).toHaveBeenCalledWith({
      queryKey: ['sla', 'policies', { includeArchived: true }],
    })
    expect(mocks.ensureQueryData).toHaveBeenCalledWith({
      queryKey: ['business-hours', 'list', {}],
    })
  })

  it('exposes the error component', () => {
    const ErrorComponent = routeOptions().errorComponent
    render(<ErrorComponent />)
    expect(screen.getByText('Failed to load SLA policies')).toBeInTheDocument()
  })
})

describe('admin settings.sla route — component', () => {
  it('renders header, tick trigger, list, and closed dialog by default', () => {
    const Component = routeOptions().component
    render(<Component />)
    expect(screen.getByText('SLA policies')).toBeInTheDocument()
    expect(screen.getByTestId('sla-tick')).toBeInTheDocument()
    expect(screen.getByTestId('gate')).toBeInTheDocument()
    expect(screen.getByTestId('sla-list')).toBeInTheDocument()
    expect(screen.getByTestId('sla-create-dialog').getAttribute('data-open')).toBe('false')
  })

  it('opens the create dialog when the New policy button is clicked', () => {
    const Component = routeOptions().component
    render(<Component />)
    expect(screen.getByTestId('sla-create-dialog').getAttribute('data-open')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'New policy' }))
    expect(screen.getByTestId('sla-create-dialog').getAttribute('data-open')).toBe('true')
  })
})
