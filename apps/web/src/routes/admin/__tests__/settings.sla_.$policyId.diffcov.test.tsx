// @vitest-environment happy-dom
import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

type RouteOptions = {
  loader: (input: {
    params: { policyId: string }
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
    useParams: () => ({ policyId: 'policy-1' }),
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

vi.mock('@/lib/client/queries/sla', () => ({
  slaQueries: {
    policy: (id: string) => ({ queryKey: ['sla', 'policy', id] }),
    escalations: (id: string) => ({ queryKey: ['sla', 'escalations', id] }),
  },
}))

vi.mock('@/lib/client/queries/business-hours', () => ({
  businessHoursQueries: {
    list: (params: unknown) => ({ queryKey: ['business-hours', 'list', params] }),
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

vi.mock('@/components/admin/settings/sla/sla-policy-overview-tab', () => ({
  SlaPolicyOverviewTab: ({ policy }: { policy: { id: string } }) => (
    <div data-testid="overview">{policy.id}</div>
  ),
}))

vi.mock('@/components/admin/settings/sla/sla-targets-tab', () => ({
  SlaTargetsTab: ({
    policyId,
    initialTargets,
  }: {
    policyId: string
    initialTargets: unknown[]
  }) => (
    <div data-testid="targets">
      {policyId}-{initialTargets.length}
    </div>
  ),
}))

vi.mock('@/components/admin/settings/sla/sla-escalations-tab', () => ({
  SlaEscalationsTab: ({ policyId }: { policyId: string }) => (
    <div data-testid="escalations">{policyId}</div>
  ),
}))

const { Route } = await import('../settings.sla_.$policyId')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

function seedDetail(
  policyOverrides: Record<string, unknown> = {},
  targets: unknown[] = [{ id: 't-1' }]
) {
  return {
    policy: {
      id: 'policy-1',
      name: 'Gold SLA',
      scope: 'workspace',
      description: 'Premium response times',
      archivedAt: null,
      ...policyOverrides,
    },
    targets,
  }
}

function renderPage() {
  const Component = routeOptions().component
  return render(<Component />)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.queryData = { policy: seedDetail(), escalations: [] }
})

describe('admin SLA policy detail route — loader', () => {
  it('prefetches policy, escalations, and business hours when detail exists', async () => {
    mocks.ensureQueryData.mockResolvedValue(seedDetail() as never)
    await routeOptions().loader({
      params: { policyId: 'policy-1' },
      context: { queryClient: { ensureQueryData: mocks.ensureQueryData } },
    })
    expect(mocks.ensureQueryData).toHaveBeenCalledTimes(3)
    expect(mocks.notFound).not.toHaveBeenCalled()
  })

  it('throws notFound when detail is missing', async () => {
    mocks.ensureQueryData.mockResolvedValue(undefined)
    await expect(
      routeOptions().loader({
        params: { policyId: 'policy-1' },
        context: { queryClient: { ensureQueryData: mocks.ensureQueryData } },
      })
    ).rejects.toThrow()
    expect(mocks.notFound).toHaveBeenCalled()
  })

  it('exposes the error component', () => {
    const ErrorComponent = routeOptions().errorComponent
    render(<ErrorComponent />)
    expect(screen.getByText('Failed to load SLA policy')).toBeInTheDocument()
  })
})

describe('admin SLA policy detail route — component', () => {
  it('returns null when detail is absent', () => {
    mocks.queryData = { policy: undefined, escalations: [] }
    const { container } = renderPage()
    expect(container.firstChild).toBeNull()
  })

  it('renders header, scope badge, description, Active badge, and tabs', () => {
    renderPage()
    expect(screen.getByText('Gold SLA')).toBeInTheDocument()
    expect(screen.getByText('workspace')).toBeInTheDocument()
    expect(screen.getByText('Premium response times')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByTestId('overview').textContent).toBe('policy-1')
    expect(screen.getByTestId('targets').textContent).toBe('policy-1-1')
    expect(screen.getByTestId('escalations').textContent).toBe('policy-1')
  })

  it('shows the Archived badge when the policy is archived', () => {
    mocks.queryData = {
      policy: seedDetail({ archivedAt: '2026-01-01T00:00:00.000Z' }),
      escalations: [],
    }
    renderPage()
    expect(screen.getByText('Archived')).toBeInTheDocument()
  })

  it('omits the description when not provided', () => {
    mocks.queryData = {
      policy: seedDetail({ description: null }),
      escalations: [],
    }
    renderPage()
    expect(screen.queryByText('Premium response times')).not.toBeInTheDocument()
  })
})
