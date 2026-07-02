// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SlaPolicyOverviewTab } from '../sla-policy-overview-tab'

type MutationOptions = {
  mutationFn: () => Promise<unknown>
  onSuccess?: (result: unknown) => void
  onError?: (error: Error) => void
}

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  updateSlaPolicyFn: vi.fn(),
  archiveSlaPolicyFn: vi.fn(),
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
  }: {
    id?: string
    type?: string
    value?: string | number
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
  }) => <input id={id} type={type} value={value} onChange={onChange} />,
}))

vi.mock('@/components/ui/textarea', () => ({
  Textarea: ({
    id,
    value,
    onChange,
  }: {
    id?: string
    value?: string
    onChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void
    rows?: number
  }) => <textarea id={id} value={value} onChange={onChange} />,
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

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: ReactNode; variant?: string }) => <span>{children}</span>,
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

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTrigger: ({ children }: { children: ReactNode; asChild?: boolean }) => <>{children}</>,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <h3>{children}</h3>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  AlertDialogCancel: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogAction: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/admin/shared/permission-gate', () => ({
  PermissionGate: ({ children }: { children: ReactNode; permission: string }) => <>{children}</>,
}))

vi.mock('@/lib/server/functions/sla', () => ({
  updateSlaPolicyFn: mocks.updateSlaPolicyFn,
  archiveSlaPolicyFn: mocks.archiveSlaPolicyFn,
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

function policy(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sla_policy_1',
    name: 'Premium policy',
    description: 'Initial description',
    priority: 100,
    enabled: true,
    scope: 'team',
    scopeTeamId: 'team_support',
    scopeInboxId: null,
    appliesToPriorities: ['low'],
    businessHoursId: 'business_hours_archived',
    pauseOnPending: true,
    pauseOnOnHold: true,
    archivedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.updateSlaPolicyFn.mockResolvedValue({ id: 'sla_policy_1' })
  mocks.archiveSlaPolicyFn.mockResolvedValue({ id: 'sla_policy_1' })
})

describe('SlaPolicyOverviewTab', () => {
  it('updates editable policy fields and keeps the current archived calendar selectable', async () => {
    render(<SlaPolicyOverviewTab policy={policy() as never} />)

    expect(screen.getByText('team')).toBeInTheDocument()
    expect(screen.getByText('team: team_support')).toBeInTheDocument()
    expect(screen.getByText('Archived calendar')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Updated SLA  ' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '   ' } })
    fireEvent.change(screen.getByLabelText('Priority (lower runs first)'), {
      target: { value: '' },
    })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'business_hours_active' } })
    fireEvent.click(screen.getByRole('button', { name: 'low' }))
    fireEvent.click(screen.getByRole('button', { name: 'urgent' }))
    fireEvent.click(screen.getByLabelText('Pending'))
    fireEvent.click(screen.getByLabelText('On hold'))
    fireEvent.click(screen.getByLabelText('Enabled'))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(mocks.updateSlaPolicyFn).toHaveBeenCalledWith({
        data: {
          id: 'sla_policy_1',
          name: 'Updated SLA',
          description: null,
          priority: 0,
          enabled: false,
          appliesToPriorities: ['urgent'],
          businessHoursId: 'business_hours_active',
          pauseOnPending: false,
          pauseOnOnHold: false,
        },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Policy updated')
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sla'] })
  })

  it('sends all-priorities and 24-7 calendar payloads when filters are cleared', async () => {
    render(
      <SlaPolicyOverviewTab
        policy={policy({ appliesToPriorities: null, businessHoursId: null }) as never}
      />
    )

    expect(screen.getByText('All priorities')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(mocks.updateSlaPolicyFn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            appliesToPriorities: undefined,
            businessHoursId: null,
          }),
        })
      )
    })
  })

  it('archives active policies and hides archive controls for archived policies', async () => {
    const { rerender } = render(<SlaPolicyOverviewTab policy={policy() as never} />)

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))

    await waitFor(() => {
      expect(mocks.archiveSlaPolicyFn).toHaveBeenCalledWith({ data: { id: 'sla_policy_1' } })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Policy archived')

    rerender(
      <SlaPolicyOverviewTab policy={policy({ archivedAt: '2026-06-19T10:00:00.000Z' }) as never} />
    )
    expect(screen.queryByText('Archive this SLA policy?')).not.toBeInTheDocument()
  })

  it('resets local form state on policy changes and reports mutation errors', async () => {
    mocks.updateSlaPolicyFn.mockRejectedValueOnce(new Error('Update failed'))
    mocks.archiveSlaPolicyFn.mockRejectedValueOnce(new Error('Archive failed'))
    const { rerender } = render(<SlaPolicyOverviewTab policy={policy() as never} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unsaved' } })
    rerender(
      <SlaPolicyOverviewTab
        policy={
          policy({
            id: 'sla_policy_2',
            name: 'Replacement policy',
            scope: 'inbox',
            scopeTeamId: null,
            scopeInboxId: 'inbox_support',
          }) as never
        }
      />
    )
    expect(screen.getByLabelText('Name')).toHaveValue('Replacement policy')
    expect(screen.getByText('inbox: inbox_support')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Update failed')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Archive failed')
    })
  })
})
