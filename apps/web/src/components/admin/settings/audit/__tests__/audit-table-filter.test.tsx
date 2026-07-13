// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { AuditEventTable } from '../audit-event-table'
import { AuditFilterBar } from '../audit-filter-bar'
import type { AuditFilters } from '@/lib/client/queries/audit'

type ComponentProps = {
  children?: ReactNode
  className?: string
  onClick?: () => void
  disabled?: boolean
}

const mocks = vi.hoisted(() => ({
  auditPages: [] as Array<{ items: unknown[] }>,
  hasNextPage: true,
  isFetchingNextPage: false,
  fetchNextPage: vi.fn(),
  principals: [] as Array<{
    id: string
    displayName: string | null
    email: string | null
    role: string
  }>,
  actions: ['ticket.created', 'ticket.updated'],
  downloadAuditCsv: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useSuspenseInfiniteQuery: () => ({
    data: { pages: mocks.auditPages },
    hasNextPage: mocks.hasNextPage,
    isFetchingNextPage: mocks.isFetchingNextPage,
    fetchNextPage: mocks.fetchNextPage,
  }),
  useQuery: (options: { queryKey?: readonly unknown[] }) => {
    if (options.queryKey?.[0] === 'principals') return { data: mocks.principals }
    return { data: mocks.actions }
  },
}))

vi.mock('@/lib/client/queries/audit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/client/queries/audit')>(
    '@/lib/client/queries/audit'
  )
  return {
    ...actual,
    auditQueries: {
      list: (filters: unknown) => ({ queryKey: ['audit', 'list', filters] }),
      actions: () => ({ queryKey: ['audit', 'actions'] }),
    },
    defaultAuditFilters: () => ({ limit: 50 }),
    rangeToFromIso: (range: string) => (range === 'all' ? undefined : `from-${range}`),
  }
})

vi.mock('@/lib/client/hooks/use-debounced-value', () => ({
  useDebouncedValue: (value: unknown) => value,
}))

vi.mock('@/lib/server/functions/principals', () => ({
  getPrincipalsByIdsFn: vi.fn(),
}))

vi.mock('../audit-csv', () => ({
  downloadAuditCsv: mocks.downloadAuditCsv,
}))

vi.mock('../audit-diff-viewer', () => ({
  AuditDiffViewer: ({
    diff,
    ipAddress,
    userAgent,
  }: {
    diff?: unknown
    ipAddress?: string | null
    userAgent?: string | null
  }) => (
    <div>
      Diff {JSON.stringify(diff)} {ipAddress} {userAgent}
    </div>
  ),
}))

vi.mock('@/components/ui/table', () => ({
  Table: ({ children }: ComponentProps) => <table>{children}</table>,
  TableHeader: ({ children }: ComponentProps) => <thead>{children}</thead>,
  TableBody: ({ children }: ComponentProps) => <tbody>{children}</tbody>,
  TableRow: ({ children, className }: ComponentProps) => <tr className={className}>{children}</tr>,
  TableHead: ({ children, className }: ComponentProps) => <th className={className}>{children}</th>,
  TableCell: ({
    children,
    className,
    colSpan,
    title,
  }: ComponentProps & { colSpan?: number; title?: string }) => (
    <td className={className} colSpan={colSpan} title={title}>
      {children}
    </td>
  ),
}))

vi.mock('@/components/ui/avatar', () => ({
  Avatar: ({ children, className }: ComponentProps) => (
    <span className={className}>{children}</span>
  ),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, variant, className }: ComponentProps & { variant?: string }) => (
    <span className={className} data-variant={variant}>
      {children}
    </span>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled }: ComponentProps) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: ({
    value,
    onChange,
    onBlur,
    onKeyDown,
    placeholder,
    type,
    className,
    list,
  }: {
    value?: string
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
    onBlur?: () => void
    onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void
    placeholder?: string
    type?: string
    className?: string
    list?: string
  }) => (
    <input
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      type={type}
      className={className}
      list={list}
    />
  ),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor, className }: ComponentProps & { htmlFor?: string }) => (
    <label htmlFor={htmlFor} className={className}>
      {children}
    </label>
  ),
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    id,
  }: {
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
    id?: string
  }) => (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked ? 'true' : 'false'}
      onClick={() => onCheckedChange?.(!checked)}
    />
  ),
}))

vi.mock('@/components/ui/select', async () => {
  const React = await import('react')
  const SelectContext = React.createContext<{ onValueChange?: (value: string) => void }>({})

  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string
      onValueChange?: (value: string) => void
      children?: ReactNode
    }) => (
      <SelectContext.Provider value={{ onValueChange }}>
        <div data-value={value}>{children}</div>
      </SelectContext.Provider>
    ),
    SelectContent: ({ children }: ComponentProps) => <div>{children}</div>,
    SelectTrigger: ({ children }: ComponentProps) => <div>{children}</div>,
    SelectValue: () => <span />,
    SelectItem: ({ value, children }: ComponentProps & { value: string }) => {
      const context = React.useContext(SelectContext)
      return (
        <button type="button" onClick={() => context.onValueChange?.(value)}>
          {children}
        </button>
      )
    },
  }
})

vi.mock('@/components/admin/shared/principal-picker', () => ({
  PrincipalPicker: ({ onValueChange }: { onValueChange: (value: string | null) => void }) => (
    <button type="button" onClick={() => onValueChange('principal_2')}>
      Pick actor
    </button>
  ),
}))

function auditRow(overrides: Record<string, unknown>) {
  return {
    id: 'evt-1',
    origin: 'workspace',
    principalId: 'principal_1',
    actorDisplayName: null,
    actorEmail: null,
    actorUserId: null,
    actorType: 'user',
    actorRole: 'admin',
    authMethod: 'password',
    action: 'ticket.created',
    targetType: 'ticket',
    targetId: 'ticket-1',
    outcome: 'success',
    source: 'web',
    occurredAt: '2026-06-19T10:15:00.000Z',
    diff: { after: { subject: 'Hi' } },
    ipAddress: '127.0.0.1',
    userAgent: 'Vitest',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auditPages = [
    {
      items: [
        auditRow({ id: 'evt-1' }),
        auditRow({
          id: 'evt-2',
          origin: 'security',
          principalId: null,
          actorDisplayName: 'Deleted User',
          actorEmail: 'deleted@example.com',
          actorRole: null,
          authMethod: null,
          outcome: 'failure',
          source: null,
          targetType: null,
          targetId: null,
          action: 'auth.login.failed',
        }),
        auditRow({
          id: 'evt-3',
          principalId: null,
          actorDisplayName: null,
          actorEmail: null,
          actorUserId: null,
          actorType: null,
          outcome: null,
        }),
      ],
    },
  ]
  mocks.principals = [
    {
      id: 'principal_1',
      displayName: 'Ada Admin',
      email: 'ada@example.com',
      role: 'owner',
    },
  ]
  mocks.hasNextPage = true
  mocks.isFetchingNextPage = false
})

describe('AuditEventTable', () => {
  it('renders rows, resolves actors, expands details, exports csv, and paginates', () => {
    render(<AuditEventTable filters={{ limit: 50 } as AuditFilters} />)

    expect(screen.getByText('3 events shown')).toBeTruthy()
    expect(screen.getAllByText('Ada Admin').length).toBeGreaterThan(0)
    expect(screen.getByText('ada@example.com · admin · user · password')).toBeTruthy()
    expect(screen.getAllByText('Deleted User').length).toBeGreaterThan(0)
    expect(screen.getAllByText('System').length).toBeGreaterThan(0)
    expect(screen.getAllByText('success').length).toBeGreaterThan(0)
    expect(screen.getAllByText('failure').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(mocks.downloadAuditCsv).toHaveBeenCalledWith(mocks.auditPages[0].items)

    fireEvent.click(screen.getAllByRole('button', { name: 'Expand row' })[0])
    expect(screen.getAllByText(/Diff/).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(mocks.fetchNextPage).toHaveBeenCalledTimes(1)
  })

  it('renders empty and terminal states', () => {
    mocks.auditPages = [{ items: [] }]
    mocks.hasNextPage = false

    render(<AuditEventTable filters={{ limit: 50 } as AuditFilters} />)

    expect(screen.getByText('0 events shown')).toBeTruthy()
    expect(
      screen.getAllByText('No audit events match the current filters.').length
    ).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled()
    expect(screen.getByText('End of matching events.')).toBeTruthy()
  })
})

describe('AuditFilterBar', () => {
  it('propagates filter changes from selects, inputs, actor picker, prefix mode, and clear', () => {
    const onChange = vi.fn()
    const value = {
      limit: 50,
      origin: 'workspace',
      principalId: 'principal_1',
      action: 'ticket.created',
      targetType: 'ticket',
      targetId: 'ticket-1',
      source: 'web',
      fromIso: '2026-06-19T10:15:00.000Z',
      toIso: '2026-06-20T10:15:00.000Z',
    } as AuditFilters

    render(<AuditFilterBar value={value} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Security' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ origin: 'security' }))

    fireEvent.click(screen.getByRole('button', { name: 'Pick actor' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ principalId: 'principal_2' }))

    fireEvent.change(screen.getByPlaceholderText('e.g. ticket.created'), {
      target: { value: 'ticket.' },
    })
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ticket.', actionPrefix: undefined })
    )

    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ action: undefined, actionPrefix: 'ticket.created' })
    )

    fireEvent.change(screen.getByPlaceholderText('name@example.com'), {
      target: { value: 'auditor@example.com' },
    })
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ actorEmail: 'auditor@example.com' })
    )

    fireEvent.change(screen.getByPlaceholderText('e.g. ticket'), {
      target: { value: 'organization' },
    })
    fireEvent.blur(screen.getByPlaceholderText('e.g. ticket'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ targetType: 'organization' }))

    fireEvent.change(screen.getByPlaceholderText('ticket_...'), {
      target: { value: 'ticket-2' },
    })
    fireEvent.keyDown(screen.getByPlaceholderText('ticket_...'), { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'ticket-2' }))

    fireEvent.click(screen.getByRole('button', { name: 'api' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ source: 'api' }))

    fireEvent.click(screen.getByRole('button', { name: 'All time' }))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ fromIso: undefined, toIso: undefined })
    )

    fireEvent.change(screen.getByDisplayValue(/2026-06-19T\d\d:15/), {
      target: { value: '2026-06-21T12:30' },
    })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ fromIso: expect.any(String) }))

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(onChange).toHaveBeenCalledWith({ limit: 50 })
  })

  it('disables clear when no filters are active', () => {
    render(<AuditFilterBar value={{ limit: 50 } as AuditFilters} onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeDisabled()
  })
})
