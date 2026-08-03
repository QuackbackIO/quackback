// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SlaPolicyId } from '@quackback/ids'
import { SlaPolicyList } from '../sla-policy-list'
import { SlaTargetsTab } from '../sla-targets-tab'

type PolicyRow = {
  id: SlaPolicyId
  name: string
  scope: string
  appliesToPriorities: string[] | null
  businessHoursId: string | null
  enabled: boolean
  archivedAt: string | null
}

type CalendarRow = {
  id: string
  name: string
}

type MutationOptions<TVars> = {
  mutationFn: (vars: TVars) => Promise<unknown>
  onSuccess?: (result: unknown) => void
  onError?: (error: Error) => void
}

const mocks = vi.hoisted(() => ({
  policies: [] as PolicyRow[],
  calendars: [] as CalendarRow[],
  updateSlaPolicyFn: vi.fn(),
  replaceSlaTargetsFn: vi.fn(),
  invalidateQueries: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
  useSuspenseQuery: (options: { queryKey?: readonly unknown[] }) => {
    if (options.queryKey?.[0] === 'sla') {
      return { data: mocks.policies }
    }
    return { data: mocks.calendars }
  },
  useMutation: <TVars,>(options: MutationOptions<TVars>) => ({
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

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: ReactNode
    to: string
    params?: Record<string, string>
    className?: string
  }) => (
    <a
      href={Object.entries(params ?? {}).reduce(
        (path, [key, value]) => path.replace(`$${key}`, value),
        to
      )}
    >
      {children}
    </a>
  ),
}))

vi.mock('@/lib/client/queries/sla', () => ({
  slaQueries: {
    policies: (params: unknown) => ({ queryKey: ['sla', 'policies', params] }),
  },
}))

vi.mock('@/lib/client/queries/business-hours', () => ({
  businessHoursQueries: {
    list: (params: unknown) => ({ queryKey: ['business-hours', params] }),
  },
}))

vi.mock('@/lib/server/functions/sla', () => ({
  replaceSlaTargetsFn: mocks.replaceSlaTargetsFn,
  updateSlaPolicyFn: mocks.updateSlaPolicyFn,
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

vi.mock('@/components/admin/shared/permission-gate', () => ({
  PermissionGate: ({
    children,
  }: {
    children: ReactNode
    permission: string
    fallback?: ReactNode
  }) => <>{children}</>,
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
  TableRow: ({ children }: { children: ReactNode; className?: string }) => <tr>{children}</tr>,
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
    <input
      id={id}
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.currentTarget.checked)}
    />
  ),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: { children: ReactNode; htmlFor?: string; className?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: ReactNode; variant?: string; className?: string }) => (
    <span>{children}</span>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: () => void
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: ({
    id,
    value,
    onChange,
    placeholder,
    type = 'text',
  }: {
    id?: string
    value?: string
    onChange?: (event: { target: { value: string } }) => void
    placeholder?: string
    type?: string
    min?: number
    className?: string
  }) => (
    <input
      id={id}
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange?.({ target: { value: event.currentTarget.value } })}
    />
  ),
}))

function policy(overrides: Partial<PolicyRow> = {}): PolicyRow {
  return {
    id: 'sla_policy_1' as SlaPolicyId,
    name: 'Default SLA',
    scope: 'global',
    appliesToPriorities: null,
    businessHoursId: 'business_hours_1',
    enabled: true,
    archivedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.updateSlaPolicyFn.mockResolvedValue({ ok: true })
  mocks.replaceSlaTargetsFn.mockResolvedValue({ ok: true })
  mocks.calendars = [{ id: 'business_hours_1', name: 'EU support' }]
  mocks.policies = [
    policy(),
    policy({
      id: 'sla_policy_archived' as SlaPolicyId,
      name: 'Archived SLA',
      scope: 'team',
      appliesToPriorities: ['urgent', 'high'],
      businessHoursId: 'missing_calendar',
      enabled: false,
      archivedAt: '2026-06-20T10:00:00.000Z',
    }),
  ]
})

describe('SlaPolicyList', () => {
  it('renders active policies, toggles enabled state, and reveals archived rows', async () => {
    render(<SlaPolicyList />)

    expect(screen.getByRole('link', { name: 'Default SLA' })).toHaveAttribute(
      'href',
      '/admin/settings/sla/sla_policy_1'
    )
    expect(screen.getByText('global')).toBeInTheDocument()
    expect(screen.getByText('All')).toBeInTheDocument()
    expect(screen.getByText('EU support')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.queryByText('Archived SLA')).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('checkbox')[1])

    await waitFor(() => {
      expect(mocks.updateSlaPolicyFn).toHaveBeenCalledWith({
        data: {
          id: 'sla_policy_1',
          enabled: false,
        },
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sla'] })

    fireEvent.click(screen.getByLabelText('Show archived'))

    expect(screen.getByRole('link', { name: 'Archived SLA' })).toHaveAttribute(
      'href',
      '/admin/settings/sla/sla_policy_archived'
    )
    expect(screen.getByText('team')).toBeInTheDocument()
    expect(screen.getByText('urgent')).toBeInTheDocument()
    expect(screen.getByText('high')).toBeInTheDocument()
    expect(screen.getByText('Archived')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('reports toggle failures and renders an empty state', async () => {
    mocks.updateSlaPolicyFn.mockRejectedValueOnce(new Error('Cannot pause default SLA'))
    const { rerender } = render(<SlaPolicyList />)

    fireEvent.click(screen.getAllByRole('checkbox')[1])

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Cannot pause default SLA')
    })

    mocks.policies = []
    rerender(<SlaPolicyList />)
    expect(screen.getByText('No SLA policies yet.')).toBeInTheDocument()
  })
})

describe('SlaTargetsTab', () => {
  it('saves positive integer targets and omits blank or invalid rows', async () => {
    render(
      <SlaTargetsTab
        policyId={'sla_policy_1' as SlaPolicyId}
        initialTargets={
          [
            {
              id: 'target_1',
              policyId: 'sla_policy_1',
              kind: 'first_response',
              minutes: 15,
            },
            {
              id: 'target_2',
              policyId: 'sla_policy_1',
              kind: 'resolution',
              minutes: 240,
            },
          ] as never
        }
      />
    )

    expect(screen.getByText(/Leave a target empty/)).toBeInTheDocument()
    expect(screen.getByLabelText('First response')).toHaveValue(15)
    expect(screen.getByLabelText('Resolution')).toHaveValue(240)

    fireEvent.change(screen.getByLabelText('First response'), { target: { value: 'abc' } })
    fireEvent.change(screen.getByLabelText('Next response'), { target: { value: '30' } })
    fireEvent.change(screen.getByLabelText('Resolution'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save targets' }))

    await waitFor(() => {
      expect(mocks.replaceSlaTargetsFn).toHaveBeenCalledWith({
        data: {
          policyId: 'sla_policy_1',
          targets: [{ kind: 'next_response', minutes: 30 }],
        },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Targets updated')
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sla'] })
  })

  it('reports target save failures', async () => {
    mocks.replaceSlaTargetsFn.mockRejectedValueOnce(new Error('Targets rejected'))
    render(<SlaTargetsTab policyId={'sla_policy_1' as SlaPolicyId} initialTargets={[] as never} />)

    fireEvent.change(screen.getByLabelText('Resolution'), { target: { value: '60' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save targets' }))

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Targets rejected')
    })
  })
})
