// @vitest-environment happy-dom
import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

type RouteOptions = {
  validateSearch: (input: unknown) => unknown
  component: () => ReactElement
}

type LinkProps = {
  to: string
  children?: ReactNode
}

type SidebarProps = {
  activeScope?: string
  activeInboxId?: string
}

const mocks = vi.hoisted(() => ({
  pathname: '/admin/tickets',
  search: { scope: 'my_assigned', inboxId: undefined } as {
    scope?: string
    inboxId?: string
  },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useSearch: () => mocks.search,
  }),
  Link: ({ to, children }: LinkProps) => (
    <a href={to} data-testid={`link-${to}`}>
      {children}
    </a>
  ),
  Outlet: () => <div data-testid="outlet" />,
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => string }) =>
    select({ location: { pathname: mocks.pathname } }),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children }: { children?: ReactNode }) => <div data-testid="button">{children}</div>,
}))

vi.mock('@heroicons/react/24/outline', () => ({
  PlusIcon: () => <svg data-testid="plus-icon" />,
}))

vi.mock('@/components/admin/tickets/ticket-queue-sidebar', () => ({
  TicketQueueSidebar: ({ activeScope, activeInboxId }: SidebarProps) => (
    <div data-testid="queue-sidebar" data-scope={activeScope} data-inbox={String(activeInboxId)} />
  ),
}))

const { Route, ticketsSearchSchema } = await import('../tickets')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

function renderPage() {
  const Component = routeOptions().component
  return render(<Component />)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.pathname = '/admin/tickets'
  mocks.search = { scope: 'my_assigned', inboxId: undefined }
})

describe('admin tickets layout route — search schema', () => {
  it('validateSearch applies the my_assigned default scope', () => {
    const parsed = ticketsSearchSchema.parse({})
    expect(parsed.scope).toBe('my_assigned')
    expect(routeOptions().validateSearch).toBe(ticketsSearchSchema)
  })

  it('accepts the full set of valid scopes/statuses/sorts', () => {
    const parsed = ticketsSearchSchema.parse({
      scope: 'unassigned',
      statusCategory: 'on_hold',
      search: 'bug',
      inboxId: 'inbox-1',
      sort: 'created_asc',
    })
    expect(parsed).toEqual({
      scope: 'unassigned',
      statusCategory: 'on_hold',
      search: 'bug',
      inboxId: 'inbox-1',
      sort: 'created_asc',
    })
  })

  it('rejects an unknown scope', () => {
    expect(() => ticketsSearchSchema.parse({ scope: 'nope' })).toThrow()
  })
})

describe('admin tickets layout route — component', () => {
  it('renders the bare outlet on a detail/new route (isDetailOrNew branch)', () => {
    mocks.pathname = '/admin/tickets/ticket-123'
    renderPage()
    expect(screen.getByTestId('outlet')).toBeInTheDocument()
    expect(screen.queryByTestId('queue-sidebar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('link-/admin/tickets/new')).not.toBeInTheDocument()
  })

  it('renders the queue layout on the list route with default scope fallback', () => {
    mocks.search = { scope: undefined, inboxId: undefined }
    renderPage()
    const sidebar = screen.getByTestId('queue-sidebar')
    expect(sidebar).toHaveAttribute('data-scope', 'my_assigned')
    expect(sidebar).toHaveAttribute('data-inbox', 'undefined')
    expect(screen.getByTestId('link-/admin/tickets/new')).toBeInTheDocument()
    expect(screen.getByTestId('plus-icon')).toBeInTheDocument()
  })

  it('forwards an explicit scope and inboxId to the sidebar', () => {
    mocks.search = { scope: 'unassigned', inboxId: 'inbox-9' }
    renderPage()
    const sidebar = screen.getByTestId('queue-sidebar')
    expect(sidebar).toHaveAttribute('data-scope', 'unassigned')
    expect(sidebar).toHaveAttribute('data-inbox', 'inbox-9')
  })
})
