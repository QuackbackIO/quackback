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
  listQuery: vi.fn((params: unknown) => ({ queryKey: ['routing-rules', 'list', params] })),
  lastListScope: undefined as unknown,
  lastEditorOpen: false as boolean,
  lastInboxPickerValue: null as unknown,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}))

vi.mock('@/components/admin/shared', () => ({
  createRouteErrorComponent: (message: string) => () => <div>{message}</div>,
}))

vi.mock('@/lib/client/queries/routing-rules', () => ({
  routingRuleQueries: {
    list: mocks.listQuery,
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

vi.mock('@heroicons/react/24/outline', () => ({
  PlusIcon: () => <span />,
}))

vi.mock('@/components/admin/shared/inbox-picker', () => ({
  InboxPicker: ({
    value,
    onValueChange,
  }: {
    value: unknown
    onValueChange: (v: unknown) => void
  }) => {
    mocks.lastInboxPickerValue = value
    return (
      <button type="button" data-testid="inbox-picker" onClick={() => onValueChange('inbox-9')}>
        pick
      </button>
    )
  },
}))

vi.mock('@/components/admin/shared/permission-gate', () => ({
  PermissionGate: ({ children }: ComponentProps) => <div data-testid="gate">{children}</div>,
}))

vi.mock('@/lib/server/domains/authz', () => ({
  PERMISSIONS: {
    ROUTING_RULE_MANAGE: 'routing_rule.manage',
  },
}))

vi.mock('@/components/admin/settings/routing/routing-rule-list', () => ({
  RoutingRuleList: ({ inboxIdScope }: { inboxIdScope: unknown }) => {
    mocks.lastListScope = inboxIdScope
    return <div data-testid="rule-list" data-scope={String(inboxIdScope)} />
  },
}))

vi.mock('@/components/admin/settings/routing/routing-rule-editor-sheet', () => ({
  RoutingRuleEditorSheet: ({ open }: { open: boolean; onOpenChange: (o: boolean) => void }) => {
    mocks.lastEditorOpen = open
    return <div data-testid="editor-sheet" data-open={String(open)} />
  },
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string
    onValueChange: (v: string) => void
    children?: ReactNode
  }) => (
    <div data-testid="select" data-value={value}>
      <button
        type="button"
        data-testid="select-workspace"
        onClick={() => onValueChange('workspace')}
      >
        workspace
      </button>
      <button type="button" data-testid="select-inbox" onClick={() => onValueChange('inbox')}>
        inbox
      </button>
      <button type="button" data-testid="select-all" onClick={() => onValueChange('all')}>
        all
      </button>
      {children}
    </div>
  ),
  SelectContent: ({ children }: ComponentProps) => <div>{children}</div>,
  SelectItem: ({ children }: ComponentProps) => <div>{children}</div>,
  SelectTrigger: ({ children }: ComponentProps) => <div>{children}</div>,
  SelectValue: () => <span />,
}))

const { Route } = await import('../settings.routing-rules')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.lastListScope = undefined
  mocks.lastEditorOpen = false
  mocks.lastInboxPickerValue = null
})

describe('admin settings.routing-rules route — loader', () => {
  it('prefetches the routing-rule list', async () => {
    await routeOptions().loader({
      context: { queryClient: { ensureQueryData: mocks.ensureQueryData } },
    })
    expect(mocks.listQuery).toHaveBeenCalledWith({})
    expect(mocks.ensureQueryData).toHaveBeenCalledTimes(1)
  })

  it('exposes the error component', () => {
    const ErrorComponent = routeOptions().errorComponent
    render(<ErrorComponent />)
    expect(screen.getByText('Failed to load routing rules')).toBeInTheDocument()
  })
})

describe('admin settings.routing-rules route — component', () => {
  it('renders default (all) scope: list scope undefined, no inbox picker, editor closed', () => {
    const Component = routeOptions().component
    render(<Component />)
    expect(screen.getByText('Routing rules')).toBeInTheDocument()
    expect(screen.getByTestId('rule-list').getAttribute('data-scope')).toBe('undefined')
    expect(screen.queryByTestId('inbox-picker')).not.toBeInTheDocument()
    expect(screen.getByTestId('editor-sheet').getAttribute('data-open')).toBe('false')
  })

  it('opens the editor sheet when New rule is clicked', () => {
    const Component = routeOptions().component
    render(<Component />)
    fireEvent.click(screen.getByRole('button', { name: 'New rule' }))
    expect(screen.getByTestId('editor-sheet').getAttribute('data-open')).toBe('true')
  })

  it('workspace scope passes "workspace" to the list', () => {
    const Component = routeOptions().component
    render(<Component />)
    fireEvent.click(screen.getByTestId('select-workspace'))
    expect(screen.getByTestId('rule-list').getAttribute('data-scope')).toBe('workspace')
    expect(screen.queryByTestId('inbox-picker')).not.toBeInTheDocument()
  })

  it('inbox scope shows the picker; undefined until an inbox is chosen, then the inbox id', () => {
    const Component = routeOptions().component
    render(<Component />)
    fireEvent.click(screen.getByTestId('select-inbox'))
    // inbox mode but no inboxScope yet -> undefined branch
    expect(screen.getByTestId('rule-list').getAttribute('data-scope')).toBe('undefined')
    const picker = screen.getByTestId('inbox-picker')
    expect(picker).toBeInTheDocument()
    fireEvent.click(picker)
    // now inboxScope set -> resolves to the inbox id
    expect(screen.getByTestId('rule-list').getAttribute('data-scope')).toBe('inbox-9')
  })
})
