// @vitest-environment happy-dom
import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

type RouteOptions = {
  loader: (input: {
    params: { organizationId: string }
    context: { queryClient: { ensureQueryData: (query: unknown) => unknown } }
  }) => Promise<unknown>
  component: () => ReactElement
  errorComponent: () => ReactElement
}

type ComponentProps = {
  children?: ReactNode
  className?: string
  to?: string
  variant?: string
}

const mocks = vi.hoisted(() => ({
  ensureQueryData: vi.fn(async (q: { queryKey: readonly unknown[] }) => {
    // detail query resolves to the current org, others to []
    if (q.queryKey[1] === 'detail') return mocks.detailData
    return []
  }),
  notFound: vi.fn(() => new Error('not-found')),
  detailData: {} as Record<string, unknown> | undefined,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useParams: () => ({ organizationId: 'org-1' }),
  }),
  Link: ({ children, to }: ComponentProps) => <a href={to}>{children}</a>,
  notFound: mocks.notFound,
}))

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: () => ({ data: mocks.detailData }),
}))

vi.mock('@/components/admin/shared', () => ({
  createRouteErrorComponent: (message: string) => () => <div>{message}</div>,
}))

vi.mock('@/lib/client/queries/organizations', () => ({
  organizationQueries: {
    detail: (id: string) => ({ queryKey: ['organizations', 'detail', id] }),
  },
}))

vi.mock('@/lib/client/queries/contacts', () => ({
  contactQueries: {
    byOrg: (id: string, opts: unknown) => ({ queryKey: ['contacts', 'byOrg', id, opts] }),
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

vi.mock('@/components/admin/contacts/organization-overview-tab', () => ({
  OrganizationOverviewTab: () => <div data-testid="overview-tab" />,
}))

vi.mock('@/components/admin/contacts/organization-contacts-tab', () => ({
  OrganizationContactsTab: () => <div data-testid="contacts-tab" />,
}))

vi.mock('@/components/admin/contacts/organization-tickets-tab', () => ({
  OrganizationTicketsTab: () => <div data-testid="tickets-tab" />,
}))

const { Route } = await import('../contacts.organizations_.$organizationId')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.detailData = { name: 'Acme Inc', domain: 'acme.com', archivedAt: null }
})

describe('admin contacts organization detail route — loader', () => {
  it('prefetches detail + contacts and does not throw when detail exists', async () => {
    mocks.detailData = { name: 'Acme Inc' }
    await routeOptions().loader({
      params: { organizationId: 'org-1' },
      context: { queryClient: { ensureQueryData: mocks.ensureQueryData as never } },
    })
    expect(mocks.ensureQueryData).toHaveBeenCalledTimes(2)
    expect(mocks.notFound).not.toHaveBeenCalled()
  })

  it('throws notFound when detail resolves to undefined', async () => {
    mocks.detailData = undefined
    await expect(
      routeOptions().loader({
        params: { organizationId: 'missing' },
        context: { queryClient: { ensureQueryData: mocks.ensureQueryData as never } },
      })
    ).rejects.toThrow('not-found')
    expect(mocks.notFound).toHaveBeenCalledTimes(1)
  })

  it('exposes the error component', () => {
    const ErrorComponent = routeOptions().errorComponent
    render(<ErrorComponent />)
    expect(screen.getByText('Failed to load organization')).toBeInTheDocument()
  })
})

describe('admin contacts organization detail route — component', () => {
  it('returns null when org is missing', () => {
    mocks.detailData = undefined
    const Component = routeOptions().component
    const { container } = render(<Component />)
    expect(container.querySelector('h1')).toBeNull()
  })

  it('renders name, domain, Active badge, tabs and overview tab', () => {
    mocks.detailData = { name: 'Acme Inc', domain: 'acme.com', archivedAt: null }
    const Component = routeOptions().component
    render(<Component />)
    expect(screen.getByText('Acme Inc')).toBeInTheDocument()
    expect(screen.getByText('acme.com')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Overview')).toBeInTheDocument()
    expect(screen.getByText('Contacts')).toBeInTheDocument()
    expect(screen.getByText('Tickets')).toBeInTheDocument()
    expect(screen.getByTestId('overview-tab')).toBeInTheDocument()
  })

  it('renders Archived badge and omits domain when archived and no domain', () => {
    mocks.detailData = { name: 'Old Co', domain: null, archivedAt: '2026-01-01' }
    const Component = routeOptions().component
    render(<Component />)
    expect(screen.getByText('Old Co')).toBeInTheDocument()
    expect(screen.getByText('Archived')).toBeInTheDocument()
    expect(screen.queryByText('acme.com')).not.toBeInTheDocument()
  })
})
