// @vitest-environment happy-dom
import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

type RouteOptions = {
  loader: (input: {
    context: { queryClient: { ensureQueryData: (query: unknown) => unknown } }
  }) => Promise<unknown>
  component: () => ReactElement
  errorComponent: unknown
}

type ChildProps = {
  children?: ReactNode
  trigger?: ReactNode
  permission?: unknown
  search?: string
  showArchived?: boolean
}

const mocks = vi.hoisted(() => ({
  ensureQueryData: vi.fn(async () => undefined),
  customerPeople: vi.fn((args: unknown) => ({ queryKey: ['customerPeople', args] })),
  errorComponentSentinel: () => null,
  createRouteErrorComponent: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}))

vi.mock('@/components/admin/shared', () => ({
  createRouteErrorComponent: (...args: unknown[]) => {
    mocks.createRouteErrorComponent(...args)
    return mocks.errorComponentSentinel
  },
}))

vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    customerPeople: mocks.customerPeople,
  },
}))

vi.mock('@/components/admin/customers/customer-people-table', () => ({
  CustomerPeopleTable: ({ search, showArchived }: ChildProps) => (
    <div data-testid="people-table" data-search={search} data-archived={String(showArchived)} />
  ),
}))

vi.mock('@/components/admin/contacts/contact-create-dialog', () => ({
  ContactCreateDialog: ({ trigger }: ChildProps) => (
    <div data-testid="contact-create-dialog">{trigger}</div>
  ),
}))

vi.mock('@/components/admin/shared/permission-gate', () => ({
  PermissionGate: ({ children, permission }: ChildProps) => (
    <div data-testid="permission-gate" data-permission={String(permission)}>
      {children}
    </div>
  ),
}))

vi.mock('@/lib/server/domains/authz', () => ({
  PERMISSIONS: { ORG_MANAGE: 'org.manage' },
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children }: ChildProps) => <button type="button">{children}</button>,
}))

vi.mock('@/components/ui/input', () => ({
  Input: ({
    value,
    onChange,
    placeholder,
  }: {
    value?: string
    onChange?: (e: { target: { value: string } }) => void
    placeholder?: string
  }) => (
    <input data-testid="search-input" placeholder={placeholder} value={value} onChange={onChange} />
  ),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children }: ChildProps) => <label>{children}</label>,
}))

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
  }: {
    checked?: boolean
    onCheckedChange?: (v: boolean) => void
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid="archived-switch"
      onClick={() => onCheckedChange?.(!checked)}
    />
  ),
}))

vi.mock('@heroicons/react/24/solid', () => ({
  PlusIcon: () => <svg data-testid="plus-icon" />,
}))

const { Route } = await import('../customers.people')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

function renderPage() {
  const Component = routeOptions().component
  return render(<Component />)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('admin customers people route', () => {
  it('loader ensures customerPeople query data with default args', async () => {
    await routeOptions().loader({
      context: { queryClient: { ensureQueryData: mocks.ensureQueryData } },
    })
    expect(mocks.customerPeople).toHaveBeenCalledWith({ includeArchived: false, limit: 100 })
    expect(mocks.ensureQueryData).toHaveBeenCalledTimes(1)
  })

  it('wires the error component sentinel', () => {
    expect(routeOptions().errorComponent).toBe(mocks.errorComponentSentinel)
  })

  it('renders the page chrome with default state', () => {
    renderPage()
    expect(screen.getByTestId('search-input')).toHaveValue('')
    const table = screen.getByTestId('people-table')
    expect(table).toHaveAttribute('data-search', '')
    expect(table).toHaveAttribute('data-archived', 'false')
    expect(screen.getByTestId('permission-gate')).toHaveAttribute('data-permission', 'org.manage')
    expect(screen.getByTestId('contact-create-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('plus-icon')).toBeInTheDocument()
  })

  it('updates search state on input change', () => {
    renderPage()
    fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'acme' } })
    expect(screen.getByTestId('search-input')).toHaveValue('acme')
    expect(screen.getByTestId('people-table')).toHaveAttribute('data-search', 'acme')
  })

  it('toggles the show-archived switch and forwards it to the table', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('archived-switch'))
    expect(screen.getByTestId('people-table')).toHaveAttribute('data-archived', 'true')
  })
})
