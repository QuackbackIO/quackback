// @vitest-environment happy-dom
import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

type RouteOptions = {
  component: () => ReactElement
}

type LinkProps = {
  to: string
  className?: string
  children?: ReactNode
}

const mocks = vi.hoisted(() => ({
  pathname: '/admin/customers/people',
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  Link: ({ to, className, children }: LinkProps) => (
    <a href={to} className={className} data-testid={`link-${to}`}>
      {children}
    </a>
  ),
  Outlet: () => <div data-testid="outlet" />,
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => string }) =>
    select({ location: { pathname: mocks.pathname } }),
}))

vi.mock('@/lib/shared/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

const { Route } = await import('../contacts')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

function renderPage() {
  const Component = routeOptions().component
  return render(<Component />)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.pathname = '/admin/customers/people'
})

describe('admin contacts legacy layout route', () => {
  it('renders heading, both tabs, and the outlet', () => {
    renderPage()
    expect(screen.getByText('Customers')).toBeInTheDocument()
    expect(screen.getByText('People, organizations, and segments.')).toBeInTheDocument()
    expect(screen.getByText('People')).toBeInTheDocument()
    expect(screen.getByText('Organizations')).toBeInTheDocument()
    expect(screen.getByTestId('outlet')).toBeInTheDocument()
  })

  it('marks a tab active on exact pathname match (active branch)', () => {
    mocks.pathname = '/admin/customers/organizations'
    renderPage()
    const active = screen.getByTestId('link-/admin/customers/organizations')
    expect(active.className).toContain('border-primary')
    expect(active.className).toContain('text-foreground')
    const inactive = screen.getByTestId('link-/admin/customers/people')
    expect(inactive.className).toContain('border-transparent')
    expect(inactive.className).toContain('text-muted-foreground')
  })

  it('marks a tab active on a nested customers child route (startsWith branch)', () => {
    mocks.pathname = '/admin/customers/people/contact-123'
    renderPage()
    const active = screen.getByTestId('link-/admin/customers/people')
    expect(active.className).toContain('border-primary')
  })

  it('marks the People tab active on the legacy /admin/contacts/people path', () => {
    mocks.pathname = '/admin/contacts/people/abc'
    renderPage()
    const active = screen.getByTestId('link-/admin/customers/people')
    expect(active.className).toContain('border-primary')
  })

  it('marks the Organizations tab active on the legacy /admin/contacts/organizations path', () => {
    mocks.pathname = '/admin/contacts/organizations/abc'
    renderPage()
    const active = screen.getByTestId('link-/admin/customers/organizations')
    expect(active.className).toContain('border-primary')
  })
})
