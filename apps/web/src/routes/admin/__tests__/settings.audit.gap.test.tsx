// @vitest-environment happy-dom
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'

type RouteOptions = {
  loader: (input: {
    context: {
      queryClient: {
        ensureInfiniteQueryData: (query: unknown) => unknown
        ensureQueryData: (query: unknown) => unknown
      }
    }
  }) => Promise<unknown>
  component: () => ReactElement
  errorComponent: () => ReactElement
}

type FilterBarProps = {
  value: unknown
  onChange: (next: unknown) => void
}

const mocks = vi.hoisted(() => ({
  ensureInfiniteQueryData: vi.fn(async () => undefined),
  ensureQueryData: vi.fn(async () => undefined),
  defaultAuditFilters: vi.fn(() => ({ action: 'all' })),
  listQuery: vi.fn((filters: unknown) => ({ queryKey: ['audit', 'list', filters] })),
  actionsQuery: vi.fn(() => ({ queryKey: ['audit', 'actions'] })),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}))

vi.mock('@/components/admin/shared', () => ({
  createRouteErrorComponent: (message: string) => () => <div>{message}</div>,
}))

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => <span className={className} />,
}))

vi.mock('@/lib/client/queries/audit', () => ({
  auditQueries: {
    list: mocks.listQuery,
    actions: mocks.actionsQuery,
  },
  defaultAuditFilters: mocks.defaultAuditFilters,
}))

vi.mock('@/components/admin/settings/audit/audit-filter-bar', () => ({
  AuditFilterBar: ({ value, onChange }: FilterBarProps) => (
    <button
      type="button"
      data-testid="filter-bar"
      data-value={JSON.stringify(value)}
      onClick={() => onChange({ action: 'login' })}
    >
      filter
    </button>
  ),
}))

vi.mock('@/components/admin/settings/audit/audit-event-table', () => ({
  AuditEventTable: ({ filters }: { filters: unknown }) => (
    <div data-testid="event-table" data-filters={JSON.stringify(filters)} />
  ),
}))

const { Route } = await import('../settings.audit')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('admin settings.audit route — loader', () => {
  it('prefetches the audit list and action options', async () => {
    await routeOptions().loader({
      context: {
        queryClient: {
          ensureInfiniteQueryData: mocks.ensureInfiniteQueryData,
          ensureQueryData: mocks.ensureQueryData,
        },
      },
    })
    expect(mocks.defaultAuditFilters).toHaveBeenCalled()
    expect(mocks.listQuery).toHaveBeenCalledWith({ action: 'all' })
    expect(mocks.actionsQuery).toHaveBeenCalled()
    expect(mocks.ensureInfiniteQueryData).toHaveBeenCalledTimes(1)
    expect(mocks.ensureQueryData).toHaveBeenCalledTimes(1)
  })

  it('exposes the error component', () => {
    const ErrorComponent = routeOptions().errorComponent
    render(<ErrorComponent />)
    expect(screen.getByText('Failed to load audit log')).toBeInTheDocument()
  })
})

describe('admin settings.audit route — component', () => {
  it('renders header, filter bar, and event table with default filters', () => {
    const Component = routeOptions().component
    render(<Component />)
    expect(screen.getByText('Audit log')).toBeInTheDocument()
    expect(screen.getByTestId('filter-bar')).toBeInTheDocument()
    const table = screen.getByTestId('event-table')
    expect(table.getAttribute('data-filters')).toBe(JSON.stringify({ action: 'all' }))
  })

  it('updates filters via the filter bar onChange (setState branch)', () => {
    const Component = routeOptions().component
    render(<Component />)
    act(() => {
      screen.getByTestId('filter-bar').click()
    })
    const table = screen.getByTestId('event-table')
    expect(table.getAttribute('data-filters')).toBe(JSON.stringify({ action: 'login' }))
  })
})
