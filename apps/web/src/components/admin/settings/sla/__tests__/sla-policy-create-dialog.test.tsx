// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SlaPolicyCreateDialog } from '../sla-policy-create-dialog'

type MutationOptions = {
  mutationFn: () => Promise<{ id: string }>
  onSuccess?: (result: { id: string }) => void
  onError?: (error: Error) => void
}

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  navigate: vi.fn(),
  createSlaPolicyFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
  useSuspenseQuery: () => ({
    data: [
      { id: 'business_hours_active', name: 'Active calendar', archivedAt: null },
      { id: 'business_hours_archived', name: 'Archived calendar', archivedAt: '2026-01-01' },
    ],
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

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    navigate: mocks.navigate,
  }),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode; className?: string }) => (
    <section>{children}</section>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
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

vi.mock('@/components/admin/shared/team-picker', () => ({
  TeamPicker: ({ onValueChange }: { onValueChange: (id: string | null) => void }) => (
    <button type="button" onClick={() => onValueChange('team_sla')}>
      Pick SLA team
    </button>
  ),
}))

vi.mock('@/components/admin/shared/inbox-picker', () => ({
  InboxPicker: ({ onValueChange }: { onValueChange: (id: string | null) => void }) => (
    <button type="button" onClick={() => onValueChange('inbox_sla')}>
      Pick SLA inbox
    </button>
  ),
}))

vi.mock('@/lib/server/functions/sla', () => ({
  createSlaPolicyFn: mocks.createSlaPolicyFn,
}))

vi.mock('@/lib/client/queries/business-hours', () => ({
  businessHoursQueries: {
    list: (params: unknown) => ({ queryKey: ['business-hours', params] }),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

function renderDialog(open = true) {
  const onOpenChange = vi.fn()
  const view = render(<SlaPolicyCreateDialog open={open} onOpenChange={onOpenChange} />)
  return { ...view, onOpenChange }
}

function selects() {
  return screen.getAllByRole('combobox') as HTMLSelectElement[]
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createSlaPolicyFn.mockResolvedValue({ id: 'sla_policy_new' })
})

describe('SlaPolicyCreateDialog', () => {
  it('does not render content while closed', () => {
    renderDialog(false)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('validates team scope and creates a policy with selected filters', async () => {
    const { onOpenChange } = renderDialog()

    expect(screen.getByRole('heading', { name: 'New SLA policy' })).toBeInTheDocument()
    expect(screen.getByText('All priorities')).toBeInTheDocument()
    expect(screen.queryByText('Archived calendar')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create policy' }))
    expect(mocks.toastError).toHaveBeenCalledWith('Name is required')

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Premium SLA  ' } })
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: '  Premium customers only  ' },
    })
    fireEvent.change(selects()[0], { target: { value: 'team' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create policy' }))
    expect(mocks.toastError).toHaveBeenCalledWith('Pick a team for team scope')

    fireEvent.click(screen.getByRole('button', { name: 'Pick SLA team' }))
    fireEvent.change(screen.getByLabelText('Priority (lower runs first)'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'low' }))
    fireEvent.click(screen.getByRole('button', { name: 'urgent' }))
    fireEvent.click(screen.getByRole('button', { name: 'low' }))
    fireEvent.change(selects()[1], { target: { value: 'business_hours_active' } })
    fireEvent.click(screen.getByLabelText('Pending'))
    fireEvent.click(screen.getByLabelText('On hold'))
    fireEvent.click(screen.getByLabelText('Enabled'))
    fireEvent.click(screen.getByRole('button', { name: 'Create policy' }))

    await waitFor(() => {
      expect(mocks.createSlaPolicyFn).toHaveBeenCalledWith({
        data: {
          name: 'Premium SLA',
          description: 'Premium customers only',
          priority: 0,
          enabled: false,
          scope: 'team',
          scopeTeamId: 'team_sla',
          scopeInboxId: null,
          appliesToPriorities: ['urgent'],
          businessHoursId: 'business_hours_active',
          pauseOnPending: false,
          pauseOnOnHold: false,
        },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Policy created')
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sla'] })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/admin/settings/sla/$policyId',
      params: { policyId: 'sla_policy_new' },
    })
    expect(screen.getByLabelText('Name')).toHaveValue('')
  })

  it('validates inbox scope and reports create errors', async () => {
    mocks.createSlaPolicyFn.mockRejectedValueOnce(new Error('Policy already exists'))
    renderDialog()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Inbox SLA' } })
    fireEvent.change(selects()[0], { target: { value: 'inbox' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create policy' }))
    expect(mocks.toastError).toHaveBeenCalledWith('Pick an inbox for inbox scope')

    fireEvent.click(screen.getByRole('button', { name: 'Pick SLA inbox' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create policy' }))

    await waitFor(() => {
      expect(mocks.createSlaPolicyFn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            description: null,
            scope: 'inbox',
            scopeTeamId: null,
            scopeInboxId: 'inbox_sla',
            appliesToPriorities: undefined,
            businessHoursId: null,
          }),
        })
      )
    })
    expect(mocks.toastError).toHaveBeenCalledWith('Policy already exists')
  })

  it('cancels through onOpenChange', () => {
    const { onOpenChange } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
