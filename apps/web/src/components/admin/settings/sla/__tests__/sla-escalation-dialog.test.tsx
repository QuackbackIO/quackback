// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SlaEscalationDialog } from '../sla-escalation-dialog'

type MutationOptions = {
  mutationFn: () => Promise<unknown>
  onSuccess?: (result: unknown) => void
  onError?: (error: Error) => void
}

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  createEscalationRuleFn: vi.fn(),
  updateEscalationRuleFn: vi.fn(),
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
    <>
      <button type="button" onClick={() => onValueChange('team_escalation')}>
        Pick escalation team
      </button>
      <button type="button" onClick={() => onValueChange(null)}>
        Clear escalation team
      </button>
    </>
  ),
}))

vi.mock('@/components/admin/shared/principal-picker', () => ({
  PrincipalPicker: ({ onValueChange }: { onValueChange: (ids: string[]) => void }) => (
    <button type="button" onClick={() => onValueChange(['principal_manager', 'principal_owner'])}>
      Pick escalation principals
    </button>
  ),
}))

vi.mock('@/lib/server/functions/sla', () => ({
  createEscalationRuleFn: mocks.createEscalationRuleFn,
  updateEscalationRuleFn: mocks.updateEscalationRuleFn,
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

function renderDialog(props: Partial<React.ComponentProps<typeof SlaEscalationDialog>> = {}) {
  const onOpenChange = vi.fn()
  const view = render(
    <SlaEscalationDialog
      policyId={'sla_policy_1' as never}
      open
      onOpenChange={onOpenChange}
      {...props}
    />
  )
  return { ...view, onOpenChange }
}

function selects() {
  return screen.getAllByRole('combobox') as HTMLSelectElement[]
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createEscalationRuleFn.mockResolvedValue({ id: 'escalation_rule_new' })
  mocks.updateEscalationRuleFn.mockResolvedValue({ id: 'escalation_rule_1' })
})

describe('SlaEscalationDialog', () => {
  it('does not render content while closed', () => {
    render(
      <SlaEscalationDialog policyId={'sla_policy_1' as never} open={false} onOpenChange={vi.fn()} />
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('validates and creates a team escalation rule', async () => {
    const { onOpenChange } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(mocks.toastError).toHaveBeenCalledWith('Name is required')

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: '  Notify team lead  ' },
    })
    fireEvent.change(selects()[0], { target: { value: 'resolution' } })
    fireEvent.change(screen.getByLabelText('Lead minutes (signed)'), {
      target: { value: '15' },
    })
    expect(screen.getByText('Fires 15m before breach')).toBeInTheDocument()

    fireEvent.change(selects()[1], { target: { value: 'team' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(mocks.toastError).toHaveBeenCalledWith('Pick a team')

    fireEvent.click(screen.getByRole('button', { name: 'Pick escalation team' }))
    fireEvent.click(screen.getByRole('button', { name: 'in_app' }))
    fireEvent.click(screen.getByRole('button', { name: 'email' }))
    fireEvent.click(screen.getByRole('button', { name: 'webhook' }))
    fireEvent.click(screen.getByLabelText('Enabled'))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(mocks.createEscalationRuleFn).toHaveBeenCalledWith({
        data: {
          policyId: 'sla_policy_1',
          name: 'Notify team lead',
          leadMinutes: 15,
          targetKind: 'resolution',
          recipientType: 'team',
          recipientTeamId: 'team_escalation',
          recipientPrincipalIds: undefined,
          channels: ['email', 'webhook'],
          enabled: false,
        },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Escalation created')
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['sla', 'escalations', 'sla_policy_1'],
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('requires principals and at least one channel before create', async () => {
    renderDialog()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Notify owners' } })
    fireEvent.change(screen.getByLabelText('Lead minutes (signed)'), {
      target: { value: '-10' },
    })
    expect(screen.getByText('Fires 10m after breach')).toBeInTheDocument()
    fireEvent.change(selects()[1], { target: { value: 'principals' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(mocks.toastError).toHaveBeenCalledWith('Pick at least one principal')

    fireEvent.click(screen.getByRole('button', { name: 'Pick escalation principals' }))
    fireEvent.click(screen.getByRole('button', { name: 'in_app' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(mocks.toastError).toHaveBeenCalledWith('Pick at least one channel')

    fireEvent.click(screen.getByRole('button', { name: 'email' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(mocks.createEscalationRuleFn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            leadMinutes: -10,
            recipientType: 'principals',
            recipientTeamId: null,
            recipientPrincipalIds: ['principal_manager', 'principal_owner'],
            channels: ['email'],
          }),
        })
      )
    })
  })

  it('updates an existing escalation and reports update errors', async () => {
    mocks.updateEscalationRuleFn.mockRejectedValueOnce(new Error('Escalation update failed'))
    const { onOpenChange } = renderDialog({
      rule: {
        id: 'escalation_rule_1',
        name: 'Existing rule',
        leadMinutes: 0,
        targetKind: 'next_response',
        recipientType: 'principals',
        recipientTeamId: null,
        recipientPrincipalIds: null,
        channels: null,
        enabled: true,
      } as never,
    })

    expect(screen.getByRole('heading', { name: 'Edit escalation' })).toBeInTheDocument()
    expect(screen.getByText('Fires at breach')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Updated rule' } })
    fireEvent.change(selects()[1], { target: { value: 'inbox_members' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Escalation update failed')
    })

    mocks.updateEscalationRuleFn.mockResolvedValueOnce({ id: 'escalation_rule_1' })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(mocks.updateEscalationRuleFn).toHaveBeenLastCalledWith({
        data: {
          id: 'escalation_rule_1',
          name: 'Updated rule',
          leadMinutes: 0,
          targetKind: 'next_response',
          recipientType: 'inbox_members',
          recipientTeamId: null,
          recipientPrincipalIds: undefined,
          channels: ['in_app'],
          enabled: true,
        },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Escalation updated')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('cancels edits through onOpenChange', () => {
    const { onOpenChange } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
