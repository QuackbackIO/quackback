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
  listQuery: vi.fn((params: { includeArchived?: boolean }) => ({
    queryKey: ['business-hours', 'list', params],
  })),
  dialogState: { open: false as boolean },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}))

vi.mock('@/components/admin/shared', () => ({
  createRouteErrorComponent: (message: string) => () => <div>{message}</div>,
}))

vi.mock('@/lib/client/queries/business-hours', () => ({
  businessHoursQueries: {
    list: mocks.listQuery,
  },
}))

vi.mock('@/components/admin/settings/sla/business-hours-list', () => ({
  BusinessHoursList: () => <div data-testid="bh-list" />,
}))

vi.mock('@/components/admin/settings/sla/business-hours-dialog', () => ({
  BusinessHoursDialog: ({ open }: { open: boolean; onOpenChange: (open: boolean) => void }) => {
    mocks.dialogState.open = open
    return <div data-testid="bh-dialog" data-open={String(open)} />
  },
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
    BUSINESS_HOURS_MANAGE: 'business_hours.manage',
  },
}))

const { Route } = await import('../settings.business-hours')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.dialogState.open = false
})

describe('admin settings.business-hours route — loader', () => {
  it('prefetches the business-hours list including archived', async () => {
    await routeOptions().loader({
      context: { queryClient: { ensureQueryData: mocks.ensureQueryData } },
    })
    expect(mocks.listQuery).toHaveBeenCalledWith({ includeArchived: true })
    expect(mocks.ensureQueryData).toHaveBeenCalledTimes(1)
    expect(mocks.ensureQueryData).toHaveBeenCalledWith({
      queryKey: ['business-hours', 'list', { includeArchived: true }],
    })
  })

  it('exposes the error component', () => {
    const ErrorComponent = routeOptions().errorComponent
    render(<ErrorComponent />)
    expect(screen.getByText('Failed to load business hours')).toBeInTheDocument()
  })
})

describe('admin settings.business-hours route — component', () => {
  it('renders header, list, and closed dialog by default', () => {
    const Component = routeOptions().component
    render(<Component />)
    expect(screen.getByText('Business hours')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Calendars define working hours and holidays. Used by SLA policies to compute due times.'
      )
    ).toBeInTheDocument()
    expect(screen.getByTestId('gate')).toBeInTheDocument()
    expect(screen.getByTestId('bh-list')).toBeInTheDocument()
    expect(screen.getByTestId('bh-dialog').getAttribute('data-open')).toBe('false')
  })

  it('opens the create dialog when the New calendar button is clicked', () => {
    const Component = routeOptions().component
    render(<Component />)
    expect(screen.getByTestId('bh-dialog').getAttribute('data-open')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'New calendar' }))
    expect(screen.getByTestId('bh-dialog').getAttribute('data-open')).toBe('true')
  })
})
