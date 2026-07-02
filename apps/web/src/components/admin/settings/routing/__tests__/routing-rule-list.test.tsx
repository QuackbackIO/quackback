// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RoutingRuleList } from '../routing-rule-list'

type MutationOptions<TVars, TResult> = {
  mutationFn: (vars: TVars) => Promise<TResult>
  onSuccess?: (result: TResult) => void
  onError?: (error: Error) => void
}

type Rule = {
  id: string
  name: string
  inboxIdScope: string | null
  enabled: boolean
  priority: number
  conditions: { conditions?: unknown[] } | null
  actions: unknown[] | null
  matchCount: number
  lastMatchedAt: string | null
}

type Inbox = {
  id: string
  slug: string
}

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  reorderRoutingRulesFn: vi.fn(),
  updateRoutingRuleFn: vi.fn(),
  deleteRoutingRuleFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  permissionAllowed: true,
  rules: [] as Rule[],
  inboxes: [] as Inbox[],
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
  useSuspenseQuery: (options: { queryKey: readonly unknown[] }) => ({
    data: options.queryKey[0] === 'routing-rules' ? mocks.rules : mocks.inboxes,
  }),
  useMutation: <TVars, TResult>(options: MutationOptions<TVars, TResult>) => ({
    isPending: false,
    mutate: async (vars: TVars) => {
      try {
        const result = await options.mutationFn(vars)
        options.onSuccess?.(result)
      } catch (error) {
        options.onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    },
  }),
}))

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({
    children,
    onDragEnd,
  }: {
    children: ReactNode
    sensors?: unknown
    collisionDetection?: unknown
    onDragEnd: (event: { active: { id: string }; over: { id: string } | null }) => void
  }) => (
    <div>
      {children}
      <button
        type="button"
        onClick={() => onDragEnd({ active: { id: 'rule_two' }, over: { id: 'rule_one' } })}
      >
        Drag second before first
      </button>
      <button
        type="button"
        onClick={() => onDragEnd({ active: { id: 'rule_one' }, over: { id: 'rule_one' } })}
      >
        Drag same item
      </button>
      <button
        type="button"
        onClick={() => onDragEnd({ active: { id: 'missing_rule' }, over: { id: 'rule_one' } })}
      >
        Drag missing item
      </button>
      <button type="button" onClick={() => onDragEnd({ active: { id: 'rule_one' }, over: null })}>
        Drop without target
      </button>
    </div>
  ),
  KeyboardSensor: class KeyboardSensor {},
  PointerSensor: class PointerSensor {},
  closestCenter: vi.fn(),
  useSensor: (sensor: unknown, options?: unknown) => ({ sensor, options }),
  useSensors: (...sensors: unknown[]) => sensors,
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: ReactNode; items: string[]; strategy: unknown }) => (
    <div>{children}</div>
  ),
  arrayMove: <T,>(items: T[], oldIndex: number, newIndex: number): T[] => {
    const next = items.slice()
    const [item] = next.splice(oldIndex, 1)
    next.splice(newIndex, 0, item)
    return next
  },
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: ({ id }: { id: string }) => ({
    attributes: { 'data-sortable-id': id },
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: id === 'dragging_rule',
  }),
  verticalListSortingStrategy: 'vertical',
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: (transform: unknown) => (transform ? 'translate3d(0, 0, 0)' : undefined),
    },
  },
}))

vi.mock('@/components/admin/shared/permission-gate', () => ({
  PermissionGate: ({
    children,
    fallback = null,
  }: {
    children: ReactNode
    fallback?: ReactNode
    permission: string
  }) => (mocks.permissionAllowed ? <>{children}</> : <>{fallback}</>),
}))

vi.mock('@/components/admin/settings/routing/routing-rule-editor-sheet', () => ({
  RoutingRuleEditorSheet: ({
    open,
    onOpenChange,
    rule,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    rule: Rule
  }) =>
    open ? (
      <section role="dialog">
        <span>Editing {rule.name}</span>
        <button type="button" onClick={() => onOpenChange(false)}>
          Close editor
        </button>
      </section>
    ) : null,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
    onClick,
    type = 'button',
    'aria-label': ariaLabel,
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: () => void
    type?: 'button' | 'submit' | 'reset'
    variant?: string
    size?: string
    className?: string
    'aria-label'?: string
  }) => (
    <button type={type} disabled={disabled} onClick={onClick} aria-label={ariaLabel}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
  }: {
    checked: boolean
    onCheckedChange: (checked: boolean) => void
  }) => (
    <input
      aria-label={`enabled-${checked ? 'on' : 'off'}`}
      type="checkbox"
      checked={checked}
      onChange={() => onCheckedChange(!checked)}
    />
  ),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: ReactNode; variant?: string; className?: string }) => (
    <span>{children}</span>
  ),
}))

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogAction: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogContent: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <h3>{children}</h3>,
  AlertDialogTrigger: ({ children }: { children: ReactNode; asChild?: boolean }) => <>{children}</>,
}))

vi.mock('@heroicons/react/24/outline', () => ({
  Bars3Icon: () => <span aria-hidden="true">bars</span>,
  PencilSquareIcon: () => <span aria-hidden="true">pencil</span>,
  TrashIcon: () => <span aria-hidden="true">trash</span>,
}))

vi.mock('@/lib/server/functions/routing', () => ({
  reorderRoutingRulesFn: mocks.reorderRoutingRulesFn,
  updateRoutingRuleFn: mocks.updateRoutingRuleFn,
  deleteRoutingRuleFn: mocks.deleteRoutingRuleFn,
}))

vi.mock('@/lib/client/queries/routing-rules', () => ({
  routingRuleQueries: {
    list: ({ inboxIdScope }: { inboxIdScope?: string }) => ({
      queryKey: ['routing-rules', { inboxIdScope }],
    }),
  },
}))

vi.mock('@/lib/client/queries/inboxes', () => ({
  inboxQueries: {
    list: ({ includeArchived }: { includeArchived?: boolean } = {}) => ({
      queryKey: ['inboxes', 'list', { includeArchived }],
    }),
  },
}))

vi.mock('@/lib/server/domains/authz', () => ({
  PERMISSIONS: {
    ROUTING_RULE_MANAGE: 'routing_rule.manage',
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.permissionAllowed = true
  mocks.inboxes = [
    { id: 'inbox_sales', slug: 'sales' },
    { id: 'inbox_support', slug: 'support' },
  ]
  mocks.rules = [
    {
      id: 'rule_one',
      name: 'Workspace urgent tickets',
      inboxIdScope: null,
      enabled: true,
      priority: 10,
      conditions: { conditions: [{ field: 'priority' }] },
      actions: [{ type: 'assign_team' }],
      matchCount: 1,
      lastMatchedAt: '2026-06-18T10:00:00.000Z',
    },
    {
      id: 'rule_two',
      name: 'Sales billing route',
      inboxIdScope: 'inbox_sales',
      enabled: false,
      priority: 20,
      conditions: { conditions: [{ field: 'subject' }, { field: 'body' }] },
      actions: [],
      matchCount: 2,
      lastMatchedAt: null,
    },
  ]
  mocks.reorderRoutingRulesFn.mockResolvedValue(undefined)
  mocks.updateRoutingRuleFn.mockResolvedValue({ id: 'rule_one' })
  mocks.deleteRoutingRuleFn.mockResolvedValue(undefined)
})

describe('RoutingRuleList', () => {
  it('renders an empty state when there are no rules', () => {
    mocks.rules = []

    render(<RoutingRuleList inboxIdScope="workspace" />)

    expect(screen.getByText('No routing rules yet.')).toBeInTheDocument()
  })

  it('renders scoped rule summaries and exposes edit, toggle and delete actions', async () => {
    render(<RoutingRuleList inboxIdScope="workspace" />)

    expect(screen.getByText('Workspace urgent tickets')).toBeInTheDocument()
    expect(screen.getByText('Sales billing route')).toBeInTheDocument()
    expect(screen.getByText('Workspace')).toBeInTheDocument()
    expect(screen.getByText('sales')).toBeInTheDocument()
    expect(screen.getByText(/1 condition/)).toHaveTextContent('1 condition')
    expect(screen.getByText(/2 conditions/)).toHaveTextContent('2 conditions')

    fireEvent.click(screen.getByLabelText('enabled-on'))
    await waitFor(() => {
      expect(mocks.updateRoutingRuleFn).toHaveBeenCalledWith({
        data: {
          ruleId: 'rule_one',
          enabled: false,
        },
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['routing-rules'] })

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit rule' })[0])
    expect(screen.getByRole('dialog')).toHaveTextContent('Editing Workspace urgent tickets')
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    await waitFor(() => {
      expect(mocks.deleteRoutingRuleFn).toHaveBeenCalledWith({
        data: { ruleId: 'rule_one' },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Rule deleted')
  })

  it('reorders rules optimistically and ignores no-op drag events', async () => {
    render(<RoutingRuleList />)

    fireEvent.click(screen.getByRole('button', { name: 'Drag same item' }))
    fireEvent.click(screen.getByRole('button', { name: 'Drag missing item' }))
    fireEvent.click(screen.getByRole('button', { name: 'Drop without target' }))
    expect(mocks.reorderRoutingRulesFn).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Drag second before first' }))
    await waitFor(() => {
      expect(mocks.reorderRoutingRulesFn).toHaveBeenCalledWith({
        data: { orderedIds: ['rule_two', 'rule_one'] },
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['routing-rules'] })
  })

  it('restores server order and reports errors when reorder, toggle or delete fail', async () => {
    mocks.reorderRoutingRulesFn.mockRejectedValueOnce(new Error('Cannot reorder'))
    mocks.updateRoutingRuleFn.mockRejectedValueOnce(new Error('Cannot toggle'))
    mocks.deleteRoutingRuleFn.mockRejectedValueOnce(new Error('Cannot delete'))

    render(<RoutingRuleList />)

    fireEvent.click(screen.getByRole('button', { name: 'Drag second before first' }))
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Cannot reorder')
    })

    fireEvent.click(screen.getByLabelText('enabled-on'))
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Cannot toggle')
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Cannot delete')
    })
  })

  it('renders status badges instead of controls when routing management is denied', () => {
    mocks.permissionAllowed = false

    render(<RoutingRuleList />)

    expect(screen.queryByRole('button', { name: 'Drag to reorder' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit rule' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete rule' })).not.toBeInTheDocument()
    expect(screen.getByText('Enabled')).toBeInTheDocument()
    expect(screen.getByText('Disabled')).toBeInTheDocument()
  })
})
