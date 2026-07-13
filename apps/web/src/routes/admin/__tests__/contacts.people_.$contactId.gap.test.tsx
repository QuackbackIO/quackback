// @vitest-environment happy-dom
import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

type RouteOptions = {
  loader: (input: {
    params: { contactId: string }
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
    useParams: () => ({ contactId: 'contact-1' }),
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

vi.mock('@/lib/client/queries/contacts', () => ({
  contactQueries: {
    detail: (contactId: string) => ({ queryKey: ['contacts', 'detail', contactId] }),
    links: (contactId: string) => ({ queryKey: ['contacts', 'links', contactId] }),
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

vi.mock('@/components/admin/contacts/contact-overview-tab', () => ({
  ContactOverviewTab: ({ contact }: { contact: { id: string } }) => (
    <div data-testid="overview">{contact.id}</div>
  ),
}))

vi.mock('@/components/admin/contacts/contact-linked-users-tab', () => ({
  ContactLinkedUsersTab: ({ contactId }: { contactId: string }) => (
    <div data-testid="linked">{contactId}</div>
  ),
}))

vi.mock('@/components/admin/contacts/contact-tickets-tab', () => ({
  ContactTicketsTab: ({ contactId }: { contactId: string }) => (
    <div data-testid="tickets">{contactId}</div>
  ),
}))

const { Route } = await import('../contacts.people_.$contactId')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

function seedContact(overrides: Record<string, unknown> = {}) {
  return {
    id: 'contact-1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    archivedAt: null,
    ...overrides,
  }
}

function renderPage() {
  const Component = routeOptions().component
  return render(<Component />)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.queryData = { detail: seedContact(), links: [] }
})

describe('admin contact detail route — loader', () => {
  it('prefetches detail and links queries when detail exists', async () => {
    mocks.ensureQueryData.mockResolvedValue(seedContact() as never)
    await routeOptions().loader({
      params: { contactId: 'contact-1' },
      context: { queryClient: { ensureQueryData: mocks.ensureQueryData } },
    })
    expect(mocks.ensureQueryData).toHaveBeenCalledTimes(2)
    expect(mocks.notFound).not.toHaveBeenCalled()
  })

  it('throws notFound when detail is missing', async () => {
    mocks.ensureQueryData.mockResolvedValue(undefined)
    await expect(
      routeOptions().loader({
        params: { contactId: 'contact-1' },
        context: { queryClient: { ensureQueryData: mocks.ensureQueryData } },
      })
    ).rejects.toThrow()
    expect(mocks.notFound).toHaveBeenCalled()
  })

  it('exposes the error component', () => {
    const ErrorComponent = routeOptions().errorComponent
    render(<ErrorComponent />)
    expect(screen.getByText('Failed to load contact')).toBeInTheDocument()
  })
})

describe('admin contact detail route — component', () => {
  it('returns null when contact data is absent', () => {
    mocks.queryData = { detail: undefined, links: [] }
    const { container } = renderPage()
    expect(container.firstChild).toBeNull()
  })

  it('renders name as display, email, Active badge and tabs', () => {
    renderPage()
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('ada@example.com')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByTestId('overview').textContent).toBe('contact-1')
    expect(screen.getByTestId('linked').textContent).toBe('contact-1')
    expect(screen.getByTestId('tickets').textContent).toBe('contact-1')
  })

  it('falls back to email as display when name is absent', () => {
    mocks.queryData = {
      detail: seedContact({ name: null }),
      links: [],
    }
    renderPage()
    // email appears both as display heading and as the muted email span
    expect(screen.getAllByText('ada@example.com').length).toBeGreaterThanOrEqual(1)
  })

  it('falls back to id as display when name and email are absent', () => {
    mocks.queryData = {
      detail: seedContact({ name: null, email: null }),
      links: [],
    }
    renderPage()
    // id is used as the display heading (and also echoed by tab mocks)
    expect(screen.getAllByText('contact-1').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('ada@example.com')).not.toBeInTheDocument()
  })

  it('shows the Archived badge when contact is archived', () => {
    mocks.queryData = {
      detail: seedContact({ archivedAt: '2026-01-01T00:00:00.000Z' }),
      links: [],
    }
    renderPage()
    expect(screen.getByText('Archived')).toBeInTheDocument()
  })
})
