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
    queryKey: ['organizations', 'list', params],
  })),
  listProps: { search: '' as string, showArchived: false as boolean },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}))

vi.mock('@/components/admin/shared', () => ({
  createRouteErrorComponent: (message: string) => () => <div>{message}</div>,
}))

vi.mock('@/lib/client/queries/organizations', () => ({
  organizationQueries: {
    list: mocks.listQuery,
  },
}))

vi.mock('@/components/admin/contacts/organization-list', () => ({
  OrganizationList: ({ search, showArchived }: { search: string; showArchived: boolean }) => {
    mocks.listProps.search = search
    mocks.listProps.showArchived = showArchived
    return <div data-testid="org-list" data-search={search} data-archived={String(showArchived)} />
  },
}))

vi.mock('@/components/admin/contacts/organization-create-dialog', () => ({
  OrganizationCreateDialog: ({ trigger }: { trigger?: ReactNode }) => (
    <div data-testid="org-create-dialog">{trigger}</div>
  ),
}))

vi.mock('@/components/admin/shared/permission-gate', () => ({
  PermissionGate: ({ children }: ComponentProps) => <div data-testid="gate">{children}</div>,
}))

vi.mock('@/lib/server/domains/authz', () => ({
  PERMISSIONS: {
    ORG_MANAGE: 'org.manage',
  },
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick }: ComponentProps) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: ({
    placeholder,
    value,
    onChange,
    className,
  }: {
    placeholder?: string
    value?: string
    onChange?: (event: { target: { value: string } }) => void
    className?: string
  }) => (
    <input
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      className={className}
      aria-label="search"
    />
  ),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: { children?: ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}))

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => <span className={className} />,
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    id,
    checked,
    onCheckedChange,
  }: {
    id?: string
    checked?: boolean
    onCheckedChange?: (next: boolean) => void
  }) => (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      data-testid="archived-switch"
      onClick={() => onCheckedChange?.(!checked)}
    />
  ),
}))

vi.mock('@heroicons/react/24/solid', () => ({
  PlusIcon: () => <span />,
}))

const { Route } = await import('../customers.organizations')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listProps.search = ''
  mocks.listProps.showArchived = false
})

describe('admin customers.organizations route — loader', () => {
  it('prefetches the organizations list including archived', async () => {
    await routeOptions().loader({
      context: { queryClient: { ensureQueryData: mocks.ensureQueryData } },
    })
    expect(mocks.listQuery).toHaveBeenCalledWith({ includeArchived: true })
    expect(mocks.ensureQueryData).toHaveBeenCalledTimes(1)
    expect(mocks.ensureQueryData).toHaveBeenCalledWith({
      queryKey: ['organizations', 'list', { includeArchived: true }],
    })
  })

  it('exposes the error component', () => {
    const ErrorComponent = routeOptions().errorComponent
    render(<ErrorComponent />)
    expect(screen.getByText('Failed to load organizations')).toBeInTheDocument()
  })
})

describe('admin customers.organizations route — component', () => {
  it('renders search, switch, gate, and list with defaults', () => {
    const Component = routeOptions().component
    render(<Component />)
    expect(screen.getByPlaceholderText('Search organizations...')).toBeInTheDocument()
    expect(screen.getByText('Show archived')).toBeInTheDocument()
    expect(screen.getByTestId('gate')).toBeInTheDocument()
    expect(screen.getByText('New organization')).toBeInTheDocument()
    const list = screen.getByTestId('org-list')
    expect(list.getAttribute('data-search')).toBe('')
    expect(list.getAttribute('data-archived')).toBe('false')
  })

  it('updates the search term passed to the list', () => {
    const Component = routeOptions().component
    render(<Component />)
    fireEvent.change(screen.getByPlaceholderText('Search organizations...'), {
      target: { value: 'acme' },
    })
    expect(screen.getByTestId('org-list').getAttribute('data-search')).toBe('acme')
  })

  it('toggles the show-archived switch', () => {
    const Component = routeOptions().component
    render(<Component />)
    expect(screen.getByTestId('org-list').getAttribute('data-archived')).toBe('false')
    fireEvent.click(screen.getByTestId('archived-switch'))
    expect(screen.getByTestId('org-list').getAttribute('data-archived')).toBe('true')
  })
})
