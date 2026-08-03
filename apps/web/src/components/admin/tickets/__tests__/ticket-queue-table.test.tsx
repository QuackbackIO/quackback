// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TicketQueueTable } from '../ticket-queue-table'

type MutationOptions = {
  mutationFn: (value: unknown) => Promise<{ succeeded: string[] }>
  onSuccess?: (result: { succeeded: string[] }) => void
  onError?: (error: Error) => void
}

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  bulkAssignTicketsFn: vi.fn(),
  bulkTransitionTicketsFn: vi.fn(),
  bulkChangeInboxFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
  }: {
    to: string
    params: Record<string, string>
    children: ReactNode
  }) => <a href={to.replace('$ticketId', params.ticketId)}>{children}</a>,
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
  useMutation: (options: MutationOptions) => ({
    mutate: async (value: unknown) => {
      try {
        const result = await options.mutationFn(value)
        options.onSuccess?.(result)
      } catch (error) {
        options.onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    },
  }),
}))

vi.mock('@/components/ui/table', () => ({
  Table: ({ children }: { children: ReactNode }) => <table>{children}</table>,
  TableHeader: ({ children }: { children: ReactNode }) => <thead>{children}</thead>,
  TableBody: ({ children }: { children: ReactNode }) => <tbody>{children}</tbody>,
  TableRow: ({ children }: { children: ReactNode }) => <tr>{children}</tr>,
  TableHead: ({ children }: { children: ReactNode }) => <th>{children}</th>,
  TableCell: ({ children }: { children: ReactNode }) => <td>{children}</td>,
}))

vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    'aria-label': ariaLabel,
  }: {
    checked?: boolean | 'indeterminate'
    onCheckedChange?: (checked: boolean) => void
    'aria-label'?: string
  }) => (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      checked={checked === true}
      data-indeterminate={checked === 'indeterminate' ? 'true' : undefined}
      onChange={() => onCheckedChange?.(checked !== true)}
    />
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: ReactNode
    onClick?: () => void
    size?: string
    variant?: string
    className?: string
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode; asChild?: boolean }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode; align?: string; className?: string }) => (
    <div>{children}</div>
  ),
}))

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div role="alertdialog">{children}</div> : null,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  AlertDialogAction: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/time-ago', () => ({
  TimeAgo: ({ date }: { date: Date | string }) => <time>{String(date)}</time>,
}))

vi.mock('@/components/admin/shared/permission-gate', () => ({
  PermissionGate: ({ children }: { children: ReactNode; permission: string }) => <>{children}</>,
}))

vi.mock('@/components/admin/shared/principal-picker', () => ({
  PrincipalPicker: ({ onValueChange }: { onValueChange: (id: string | null) => void }) => (
    <button type="button" onClick={() => onValueChange('principal_assignee')}>
      Pick assignee
    </button>
  ),
}))

vi.mock('@/components/admin/shared/status-picker', () => ({
  StatusPicker: ({ onValueChange }: { onValueChange: (id: string | null) => void }) => (
    <button type="button" onClick={() => onValueChange('ticket_status_solved')}>
      Pick status
    </button>
  ),
}))

vi.mock('@/components/admin/shared/inbox-picker', () => ({
  InboxPicker: ({ onValueChange }: { onValueChange: (id: string | null) => void }) => (
    <>
      <button type="button" onClick={() => onValueChange('inbox_support')}>
        Pick inbox
      </button>
      <button type="button" onClick={() => onValueChange(null)}>
        Clear inbox
      </button>
    </>
  ),
}))

vi.mock('../ticket-status-pill', () => ({
  TicketStatusPill: ({ name, category }: { name: string; category: string }) => (
    <span>
      {name}:{category}
    </span>
  ),
}))

vi.mock('../ticket-priority-chip', () => ({
  TicketPriorityChip: ({ priority }: { priority: string }) => <span>priority:{priority}</span>,
}))

vi.mock('../ticket-channel-icon', () => ({
  TicketChannelIcon: ({ channel }: { channel: string }) => <span>channel:{channel}</span>,
}))

vi.mock('@/lib/server/functions/tickets', () => ({
  bulkAssignTicketsFn: mocks.bulkAssignTicketsFn,
  bulkTransitionTicketsFn: mocks.bulkTransitionTicketsFn,
  bulkChangeInboxFn: mocks.bulkChangeInboxFn,
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

const statuses = [
  {
    id: 'ticket_status_open',
    name: 'Open',
    category: 'open' as const,
  },
  {
    id: 'ticket_status_solved',
    name: 'Solved',
    category: 'solved' as const,
  },
]

function row(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `ticket_${id}`,
    subject: `Ticket ${id}`,
    statusId: 'ticket_status_open',
    priority: id % 2 === 0 ? 'high' : 'normal',
    channel: id % 2 === 0 ? 'email' : 'widget',
    lastActivityAt: `2026-06-19T10:${String(id).padStart(2, '0')}:00.000Z`,
    assigneePrincipalId: null,
    ...overrides,
  }
}

function renderTable(rows = [row(1), row(2)]) {
  return render(
    <TicketQueueTable rows={rows} statuses={statuses} invalidateKey={['tickets', 'queue']} />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.bulkAssignTicketsFn.mockResolvedValue({ succeeded: ['ticket_1'] })
  mocks.bulkTransitionTicketsFn.mockResolvedValue({ succeeded: ['ticket_1', 'ticket_2'] })
  mocks.bulkChangeInboxFn.mockResolvedValue({ succeeded: ['ticket_1', 'ticket_2'] })
})

describe('TicketQueueTable', () => {
  it('renders the empty queue state', () => {
    renderTable([])

    expect(screen.getByText('No tickets in this view.')).toBeInTheDocument()
  })

  it('renders ticket rows and runs assign, transition, and inbox bulk actions', async () => {
    renderTable([row(1), row(2, { statusId: 'missing_status' })])

    expect(screen.getByRole('link', { name: 'Ticket 1' })).toHaveAttribute(
      'href',
      '/admin/tickets/ticket_1'
    )
    expect(screen.getByText('Open:open')).toBeInTheDocument()
    expect(screen.getByText('priority:normal')).toBeInTheDocument()
    expect(screen.getByText('channel:widget')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Select Ticket 1'))

    expect(screen.getByText('1 selected')).toBeInTheDocument()
    expect(screen.getByLabelText('Select all')).toHaveAttribute('data-indeterminate', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Pick assignee' }))

    await waitFor(() => {
      expect(mocks.bulkAssignTicketsFn).toHaveBeenCalledWith({
        data: {
          ticketIds: ['ticket_1'],
          assigneePrincipalId: 'principal_assignee',
        },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Assigned 1 ticket')
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['tickets', 'queue'] })

    fireEvent.click(screen.getByLabelText('Select all'))
    expect(screen.getByText('2 selected')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Pick status' }))
    await waitFor(() => {
      expect(mocks.bulkTransitionTicketsFn).toHaveBeenCalledWith({
        data: {
          ticketIds: ['ticket_1', 'ticket_2'],
          statusId: 'ticket_status_solved',
        },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Transitioned 2 tickets')

    fireEvent.click(screen.getByLabelText('Select all'))
    fireEvent.click(screen.getByRole('button', { name: 'Pick inbox' }))
    await waitFor(() => {
      expect(mocks.bulkChangeInboxFn).toHaveBeenCalledWith({
        data: {
          ticketIds: ['ticket_1', 'ticket_2'],
          inboxId: 'inbox_support',
        },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Moved 2 tickets')
  })

  it('clears selected rows and reports mutation failures', async () => {
    mocks.bulkAssignTicketsFn.mockRejectedValueOnce(new Error('No assignment permission'))
    renderTable([row(1)])

    fireEvent.click(screen.getByLabelText('Select Ticket 1'))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(screen.queryByText('1 selected')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Select Ticket 1'))
    fireEvent.click(screen.getByRole('button', { name: 'Pick assignee' }))

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('No assignment permission')
    })
  })

  it('requires confirmation before applying large bulk actions', async () => {
    const manyRows = Array.from({ length: 51 }, (_, index) => row(index + 1))
    renderTable(manyRows)

    fireEvent.click(screen.getByLabelText('Select all'))
    fireEvent.click(screen.getByRole('button', { name: 'Pick status' }))

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(
      screen.getByText('You are about to apply this action to 51 tickets. Continue?')
    ).toBeInTheDocument()
    expect(mocks.bulkTransitionTicketsFn).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => {
      expect(mocks.bulkTransitionTicketsFn).toHaveBeenCalledWith({
        data: {
          ticketIds: manyRows.map((ticket) => ticket.id),
          statusId: 'ticket_status_solved',
        },
      })
    })
  })

  it('can cancel a pending large bulk action', () => {
    const manyRows = Array.from({ length: 51 }, (_, index) => row(index + 1))
    renderTable(manyRows)

    fireEvent.click(screen.getByLabelText('Select all'))
    fireEvent.click(screen.getByRole('button', { name: 'Clear inbox' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(mocks.bulkChangeInboxFn).not.toHaveBeenCalled()
  })
})
