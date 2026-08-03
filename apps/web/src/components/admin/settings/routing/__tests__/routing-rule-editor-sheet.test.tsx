// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RoutingRuleEditorSheet } from '../routing-rule-editor-sheet'

type MutationOptions = {
  mutationFn: () => Promise<unknown>
  onSuccess?: (result: unknown) => void
  onError?: (error: Error) => void
}

type RuleSet = {
  match: 'all' | 'any'
  conditions: Array<{ field: string; op: string; value: string | string[] }>
}

type Action = { type: string; value: string }

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  createRoutingRuleFn: vi.fn(),
  updateRoutingRuleFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
  useMutation: (options: MutationOptions) => ({
    isPending: false,
    mutate: async () => {
      try {
        const result = await options.mutationFn()
        options.onSuccess?.(result)
      } catch (error) {
        options.onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    },
  }),
}))

vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  SheetContent: ({ children }: { children: ReactNode; side?: string; className?: string }) => (
    <section>{children}</section>
  ),
  SheetDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  SheetFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  SheetHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
    onClick,
    type = 'button',
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: () => void
    type?: 'button' | 'submit' | 'reset'
    variant?: string
    size?: string
    className?: string
  }) => (
    <button type={type} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: ({
    id,
    type = 'text',
    value,
    onChange,
    placeholder,
  }: {
    id?: string
    type?: string
    value?: string | number
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
    placeholder?: string
    min?: number
    max?: number
  }) => <input id={id} type={type} value={value} onChange={onChange} placeholder={placeholder} />,
}))

vi.mock('@/components/ui/textarea', () => ({
  Textarea: ({
    id,
    value,
    onChange,
    placeholder,
  }: {
    id?: string
    value?: string
    onChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void
    placeholder?: string
    rows?: number
  }) => <textarea id={id} value={value} onChange={onChange} placeholder={placeholder} />,
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: { children: ReactNode; htmlFor?: string; className?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    id,
    checked,
    onCheckedChange,
  }: {
    id?: string
    checked: boolean
    onCheckedChange: (checked: boolean) => void
  }) => (
    <input id={id} type="checkbox" checked={checked} onChange={() => onCheckedChange(!checked)} />
  ),
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string
    onValueChange: (value: string) => void
    children: ReactNode
  }) => (
    <select value={value} onChange={(event) => onValueChange(event.currentTarget.value)}>
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
}))

vi.mock('@/components/admin/shared/inbox-picker', () => ({
  InboxPicker: ({ onValueChange }: { onValueChange: (id: string | null) => void }) => (
    <button type="button" onClick={() => onValueChange('inbox_scope')}>
      Pick scoped inbox
    </button>
  ),
}))

vi.mock('../routing-conditions-builder', () => ({
  RoutingConditionsBuilder: ({
    value,
    onChange,
  }: {
    value: RuleSet
    onChange: (next: RuleSet) => void
  }) => (
    <div>
      <div>conditions:{value.conditions.length}</div>
      <button type="button" onClick={() => onChange({ match: 'all', conditions: [] })}>
        Empty conditions
      </button>
      <button
        type="button"
        onClick={() =>
          onChange({
            match: 'all',
            conditions: [{ field: 'subject', op: 'contains', value: '' }],
          })
        }
      >
        Missing condition value
      </button>
      <button
        type="button"
        onClick={() =>
          onChange({
            match: 'any',
            conditions: [{ field: 'priority', op: 'eq', value: 'urgent' }],
          })
        }
      >
        Valid condition
      </button>
    </div>
  ),
}))

vi.mock('../routing-actions-builder', () => ({
  RoutingActionsBuilder: ({
    value,
    onChange,
  }: {
    value: Action[]
    onChange: (next: Action[]) => void
  }) => (
    <div>
      <div>actions:{value.length}</div>
      <button type="button" onClick={() => onChange([])}>
        Empty actions
      </button>
      <button type="button" onClick={() => onChange([{ type: 'assignToInbox', value: '' }])}>
        Missing action value
      </button>
      <button
        type="button"
        onClick={() => onChange([{ type: 'assignToInbox', value: 'inbox_action' }])}
      >
        Valid action
      </button>
    </div>
  ),
}))

vi.mock('@/lib/server/functions/routing', () => ({
  createRoutingRuleFn: mocks.createRoutingRuleFn,
  updateRoutingRuleFn: mocks.updateRoutingRuleFn,
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

function renderSheet(props: Partial<React.ComponentProps<typeof RoutingRuleEditorSheet>> = {}) {
  const onOpenChange = vi.fn()
  const view = render(<RoutingRuleEditorSheet open onOpenChange={onOpenChange} {...props} />)
  return { ...view, onOpenChange }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createRoutingRuleFn.mockResolvedValue({ id: 'routing_rule_new' })
  mocks.updateRoutingRuleFn.mockResolvedValue({ id: 'routing_rule_1' })
})

describe('RoutingRuleEditorSheet', () => {
  it('does not render content while closed', () => {
    render(<RoutingRuleEditorSheet open={false} onOpenChange={vi.fn()} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('validates and creates a scoped routing rule', async () => {
    const { onOpenChange } = renderSheet()

    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }))
    expect(mocks.toastError).toHaveBeenCalledWith('Name is required')

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  VIP routing  ' } })
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: '  Move urgent customers  ' },
    })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'inbox' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }))
    expect(mocks.toastError).toHaveBeenCalledWith('Pick an inbox or switch to workspace scope')

    fireEvent.click(screen.getByRole('button', { name: 'Pick scoped inbox' }))
    fireEvent.click(screen.getByRole('button', { name: 'Empty conditions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }))
    expect(mocks.toastError).toHaveBeenCalledWith('At least one condition is required')

    fireEvent.click(screen.getByRole('button', { name: 'Missing condition value' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }))
    expect(mocks.toastError).toHaveBeenCalledWith('Condition on "subject" is missing a value')

    fireEvent.click(screen.getByRole('button', { name: 'Valid condition' }))
    fireEvent.click(screen.getByRole('button', { name: 'Empty actions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }))
    expect(mocks.toastError).toHaveBeenCalledWith('At least one action is required')

    fireEvent.click(screen.getByRole('button', { name: 'Missing action value' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }))
    expect(mocks.toastError).toHaveBeenCalledWith('Action "assignToInbox" is missing a value')

    fireEvent.click(screen.getByRole('button', { name: 'Valid action' }))
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: '' } })
    fireEvent.click(screen.getByLabelText('Enabled'))
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }))

    await waitFor(() => {
      expect(mocks.createRoutingRuleFn).toHaveBeenCalledWith({
        data: {
          name: 'VIP routing',
          description: 'Move urgent customers',
          priority: 0,
          enabled: false,
          conditions: {
            match: 'any',
            conditions: [{ field: 'priority', op: 'eq', value: 'urgent' }],
          },
          actions: [{ type: 'assignToInbox', value: 'inbox_action' }],
          inboxIdScope: 'inbox_scope',
        },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Routing rule created')
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['routing-rules'] })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('prefills and updates existing routing rules', async () => {
    const { onOpenChange } = renderSheet({
      rule: {
        id: 'routing_rule_1',
        name: 'Existing rule',
        description: null,
        inboxIdScope: null,
        priority: 25,
        enabled: true,
        conditions: {
          match: 'all',
          conditions: [{ field: 'channel', op: 'eq', value: 'email' }],
        },
        actions: [{ type: 'assignToInbox', value: 'inbox_email' }],
      } as never,
    })

    expect(screen.getByRole('heading', { name: 'Edit routing rule' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Existing rule')

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Updated rule' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(mocks.updateRoutingRuleFn).toHaveBeenCalledWith({
        data: {
          ruleId: 'routing_rule_1',
          name: 'Updated rule',
          description: null,
          priority: 25,
          enabled: true,
          conditions: {
            match: 'all',
            conditions: [{ field: 'channel', op: 'eq', value: 'email' }],
          },
          actions: [{ type: 'assignToInbox', value: 'inbox_email' }],
          inboxIdScope: null,
        },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Routing rule updated')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('reports update errors and cancels edits', async () => {
    mocks.updateRoutingRuleFn.mockRejectedValueOnce(new Error('Update failed'))
    const { onOpenChange } = renderSheet({
      rule: {
        id: 'routing_rule_1',
        name: 'Existing rule',
        description: 'Existing description',
        inboxIdScope: 'inbox_existing',
        priority: 10,
        enabled: false,
        conditions: null,
        actions: null,
      } as never,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Valid condition' }))
    fireEvent.click(screen.getByRole('button', { name: 'Valid action' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Update failed')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
