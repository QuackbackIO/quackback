// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SlaEscalationsTab } from '../sla-escalations-tab'

type Rule = {
  id: string
  name: string
  targetKind: string
  leadMinutes: number
  recipientType: string
  recipientTeamId: string | null
  recipientPrincipalIds: string[] | null
  channels: string[] | null
  enabled: boolean
}

type MutationOptions<TVars, TResult> = {
  mutationFn: (vars: TVars) => Promise<TResult>
  onSuccess?: (result: TResult) => void
  onError?: (error: Error) => void
}

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  updateEscalationRuleFn: vi.fn(),
  deleteEscalationRuleFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  permissionAllowed: true,
  rules: [] as Rule[],
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
  useSuspenseQuery: () => ({
    data: mocks.rules,
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

vi.mock('../sla-escalation-dialog', () => ({
  SlaEscalationDialog: ({
    open,
    onOpenChange,
    rule,
  }: {
    policyId: string
    open: boolean
    onOpenChange: (open: boolean) => void
    rule?: Rule
  }) =>
    open ? (
      <section role="dialog">
        <span>{rule ? `Editing ${rule.name}` : 'Creating escalation'}</span>
        <button type="button" onClick={() => onOpenChange(false)}>
          Close escalation dialog
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
      type="checkbox"
      aria-label={`enabled-${checked ? 'on' : 'off'}`}
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

vi.mock('@/components/ui/table', () => ({
  Table: ({ children }: { children: ReactNode }) => <table>{children}</table>,
  TableBody: ({ children }: { children: ReactNode }) => <tbody>{children}</tbody>,
  TableCell: ({
    children,
    colSpan,
  }: {
    children?: ReactNode
    colSpan?: number
    className?: string
  }) => <td colSpan={colSpan}>{children}</td>,
  TableHead: ({ children }: { children?: ReactNode; className?: string }) => <th>{children}</th>,
  TableHeader: ({ children }: { children: ReactNode }) => <thead>{children}</thead>,
  TableRow: ({ children }: { children: ReactNode }) => <tr>{children}</tr>,
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
  PencilSquareIcon: () => <span aria-hidden="true">pencil</span>,
  PlusIcon: () => <span aria-hidden="true">plus</span>,
  TrashIcon: () => <span aria-hidden="true">trash</span>,
}))

vi.mock('@/lib/client/queries/sla', () => ({
  slaQueries: {
    escalations: (policyId: string) => ({ queryKey: ['sla', 'escalations', policyId] }),
  },
}))

vi.mock('@/lib/server/functions/sla', () => ({
  updateEscalationRuleFn: mocks.updateEscalationRuleFn,
  deleteEscalationRuleFn: mocks.deleteEscalationRuleFn,
}))

vi.mock('@/lib/server/domains/authz', () => ({
  PERMISSIONS: {
    ESCALATION_RULE_MANAGE: 'escalation_rule.manage',
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
  mocks.rules = [
    {
      id: 'rule_before',
      name: 'Warn before breach',
      targetKind: 'first_response',
      leadMinutes: 15,
      recipientType: 'team',
      recipientTeamId: 'team_support',
      recipientPrincipalIds: null,
      channels: ['email', 'slack'],
      enabled: true,
    },
    {
      id: 'rule_at',
      name: 'Escalate at breach',
      targetKind: 'resolution',
      leadMinutes: 0,
      recipientType: 'principals',
      recipientTeamId: null,
      recipientPrincipalIds: ['principal_1', 'principal_2'],
      channels: null,
      enabled: false,
    },
    {
      id: 'rule_after',
      name: 'After breach',
      targetKind: 'resolution',
      leadMinutes: -30,
      recipientType: 'manager',
      recipientTeamId: null,
      recipientPrincipalIds: null,
      channels: ['email'],
      enabled: true,
    },
  ]
  mocks.updateEscalationRuleFn.mockResolvedValue({ id: 'rule_before' })
  mocks.deleteEscalationRuleFn.mockResolvedValue(undefined)
})

describe('SlaEscalationsTab', () => {
  it('renders empty state and opens the create dialog', () => {
    mocks.rules = []
    render(<SlaEscalationsTab policyId={'policy_1' as never} />)

    expect(screen.getByText('No escalation rules yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New escalation' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Creating escalation')
    fireEvent.click(screen.getByRole('button', { name: 'Close escalation dialog' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders lead-time, recipient and channel labels and opens edit dialog', () => {
    render(<SlaEscalationsTab policyId={'policy_1' as never} />)

    expect(screen.getByText('15m before breach')).toBeInTheDocument()
    expect(screen.getByText('At breach')).toBeInTheDocument()
    expect(screen.getByText('30m after breach')).toBeInTheDocument()
    expect(screen.getByText('team: team_support')).toBeInTheDocument()
    expect(screen.getByText('2 principal(s)')).toBeInTheDocument()
    expect(screen.getByText('manager')).toBeInTheDocument()
    expect(screen.getAllByText('email')).toHaveLength(2)
    expect(screen.getByText('slack')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit escalation' })[0])
    expect(screen.getByRole('dialog')).toHaveTextContent('Editing Warn before breach')
  })

  it('toggles and deletes escalation rules with cache invalidation', async () => {
    render(<SlaEscalationsTab policyId={'policy_1' as never} />)

    fireEvent.click(screen.getAllByLabelText('enabled-on')[0])
    await waitFor(() => {
      expect(mocks.updateEscalationRuleFn).toHaveBeenCalledWith({
        data: { id: 'rule_before', enabled: false },
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['sla', 'escalations', 'policy_1'],
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    await waitFor(() => {
      expect(mocks.deleteEscalationRuleFn).toHaveBeenCalledWith({
        data: { id: 'rule_before' },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Escalation rule deleted')
  })

  it('reports mutation errors and renders read-only fallback badges without permission', async () => {
    mocks.updateEscalationRuleFn.mockRejectedValueOnce(new Error('Toggle denied'))
    mocks.deleteEscalationRuleFn.mockRejectedValueOnce(new Error('Delete denied'))
    render(<SlaEscalationsTab policyId={'policy_1' as never} />)

    fireEvent.click(screen.getAllByLabelText('enabled-on')[0])
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Toggle denied')
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Delete denied')
    })

    cleanup()
    mocks.permissionAllowed = false
    render(<SlaEscalationsTab policyId={'policy_1' as never} />)
    expect(screen.queryByRole('button', { name: 'New escalation' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit escalation' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete escalation' })).not.toBeInTheDocument()
    expect(screen.getAllByText('On')).toHaveLength(2)
    expect(screen.getByText('Off')).toBeInTheDocument()
  })
})
