// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SlaClockChip } from '../sla-clock-chip'
import { TicketChannelIcon, type TicketChannel } from '../ticket-channel-icon'
import { TicketDetailHeader } from '../ticket-detail-header'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  invalidateQueries: vi.fn(),
  takeTicketFn: vi.fn(),
  returnTicketFn: vi.fn(),
  softDeleteTicketFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string; className?: string }) => (
    <a href={to}>{children}</a>
  ),
  useRouter: () => ({
    navigate: mocks.navigate,
  }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
  useMutation: ({
    mutationFn,
    onSuccess,
    onError,
  }: {
    mutationFn: () => Promise<unknown>
    onSuccess?: () => void
    onError?: (error: Error) => void
  }) => ({
    isPending: false,
    mutate: () => {
      void mutationFn()
        .then(() => onSuccess?.())
        .catch((error) => onError?.(error instanceof Error ? error : new Error(String(error))))
    },
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

vi.mock('@/lib/server/functions/tickets', () => ({
  takeTicketFn: mocks.takeTicketFn,
  returnTicketFn: mocks.returnTicketFn,
  softDeleteTicketFn: mocks.softDeleteTicketFn,
}))

vi.mock('@/lib/client/queries/tickets', () => ({
  ticketQueries: {
    detail: (ticketId: string) => ({ queryKey: ['tickets', 'detail', ticketId] }),
  },
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    'aria-label': ariaLabel,
    asChild,
  }: {
    children: ReactNode
    onClick?: () => void
    disabled?: boolean
    'aria-label'?: string
    asChild?: boolean
    variant?: string
    size?: string
  }) =>
    asChild ? (
      <>{children}</>
    ) : (
      <button type="button" disabled={disabled} onClick={onClick} aria-label={ariaLabel}>
        {children}
      </button>
    ),
}))

vi.mock('@/components/ui/time-ago', () => ({
  TimeAgo: ({ date }: { date: Date | string }) => <time>{String(date)}</time>,
}))

vi.mock('../ticket-priority-chip', () => ({
  TicketPriorityChip: ({ priority }: { priority: string }) => <span>Priority {priority}</span>,
}))

vi.mock('../ticket-subscription-menu', () => ({
  TicketSubscriptionMenu: ({ ticketId }: { ticketId: string }) => (
    <button type="button">Subscribe {ticketId}</button>
  ),
}))

vi.mock('@/components/ui/alert-dialog', async () => {
  const React = await import('react')
  const AlertDialogContext = React.createContext<{
    open: boolean
    setOpen: (open: boolean) => void
  }>({
    open: false,
    setOpen: () => {},
  })
  return {
    AlertDialog: ({ children }: { children: ReactNode }) => {
      const [open, setOpen] = React.useState(false)
      return (
        <AlertDialogContext.Provider value={{ open, setOpen }}>
          <div>{children}</div>
        </AlertDialogContext.Provider>
      )
    },
    AlertDialogAction: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
    AlertDialogCancel: ({ children }: { children: ReactNode }) => (
      <button type="button">{children}</button>
    ),
    AlertDialogContent: ({ children }: { children: ReactNode }) => {
      const context = React.useContext(AlertDialogContext)
      return context.open ? <section role="alertdialog">{children}</section> : null
    },
    AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
    AlertDialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
    AlertDialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
    AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
    AlertDialogTrigger: ({ children }: { children: React.ReactElement; asChild?: boolean }) => {
      const context = React.useContext(AlertDialogContext)
      return React.cloneElement(children as React.ReactElement<{ onClick?: () => void }>, {
        onClick: () => context.setOpen(true),
      })
    },
  }
})

vi.mock('@heroicons/react/24/outline', () => ({
  ArrowLeftIcon: () => <span aria-hidden="true">back</span>,
  ChatBubbleBottomCenterTextIcon: ({ 'aria-label': ariaLabel }: { 'aria-label'?: string }) => (
    <span aria-label={ariaLabel}>widget</span>
  ),
  CodeBracketIcon: ({ 'aria-label': ariaLabel }: { 'aria-label'?: string }) => (
    <span aria-label={ariaLabel}>api</span>
  ),
  EnvelopeIcon: ({ 'aria-label': ariaLabel }: { 'aria-label'?: string }) => (
    <span aria-label={ariaLabel}>email</span>
  ),
  GlobeAltIcon: ({ 'aria-label': ariaLabel }: { 'aria-label'?: string }) => (
    <span aria-label={ariaLabel}>portal</span>
  ),
  TrashIcon: () => <span aria-hidden="true">trash</span>,
}))

function ticket(overrides: Partial<Parameters<typeof TicketDetailHeader>[0]['ticket']> = {}) {
  return {
    id: 'ticket_1' as never,
    subject: 'Login is broken',
    channel: 'widget',
    priority: 'high',
    visibilityScope: 'team',
    updatedAt: '2026-06-20T10:00:00.000Z',
    assigneePrincipalId: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-06-20T10:00:00.000Z').getTime())
  mocks.takeTicketFn.mockResolvedValue(undefined)
  mocks.returnTicketFn.mockResolvedValue(undefined)
  mocks.softDeleteTicketFn.mockResolvedValue(undefined)
  mocks.invalidateQueries.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SlaClockChip', () => {
  it('formats clock states, urgency colors, and kind labels', () => {
    const { rerender } = render(
      <SlaClockChip
        showKind
        clock={{
          kind: 'first_response',
          state: 'running',
          dueAt: '2026-06-20T12:00:00.000Z',
        }}
      />
    )
    expect(screen.getByText('First response:')).toBeInTheDocument()
    expect(screen.getByText('2h 0m')).toHaveAttribute(
      'title',
      expect.stringContaining('First response due')
    )

    rerender(
      <SlaClockChip
        clock={{ kind: 'resolution', state: 'running', dueAt: '2026-06-22T11:00:00.000Z' }}
      />
    )
    expect(screen.getByText('2d 1h')).toBeInTheDocument()

    rerender(
      <SlaClockChip
        clock={{ kind: 'next_response', state: 'running', dueAt: '2026-06-20T10:30:00.000Z' }}
      />
    )
    expect(screen.getByText('30m')).toBeInTheDocument()

    rerender(
      <SlaClockChip
        clock={{ kind: 'resolution', state: 'running', dueAt: '2026-06-20T09:55:00.000Z' }}
      />
    )
    expect(screen.getByText(/5m/)).toBeInTheDocument()

    rerender(
      <SlaClockChip
        clock={{ kind: 'resolution', state: 'met', dueAt: '2026-06-20T09:00:00.000Z' }}
      />
    )
    expect(screen.getByText('Met')).toBeInTheDocument()

    rerender(
      <SlaClockChip
        clock={{ kind: 'resolution', state: 'paused', dueAt: '2026-06-20T11:00:00.000Z' }}
      />
    )
    expect(screen.getByText('Paused')).toBeInTheDocument()

    rerender(
      <SlaClockChip
        clock={{ kind: 'resolution', state: 'cancelled', dueAt: '2026-06-20T11:00:00.000Z' }}
      />
    )
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
  })
})

describe('TicketChannelIcon', () => {
  it('maps every channel to an icon', () => {
    ;(['email', 'portal', 'api', 'widget'] as TicketChannel[]).forEach((channel) => {
      const { unmount } = render(<TicketChannelIcon channel={channel} className="custom" />)
      expect(screen.getByLabelText(channel)).toBeInTheDocument()
      unmount()
    })
  })
})

describe('TicketDetailHeader', () => {
  it('takes, returns, subscribes, and deletes tickets', async () => {
    const { rerender } = render(
      <TicketDetailHeader ticket={ticket()} currentPrincipalId={'principal_1' as never} />
    )

    expect(screen.getByRole('link', { name: /Queue/ })).toHaveAttribute('href', '/admin/tickets')
    expect(screen.getByText('Login is broken')).toBeInTheDocument()
    expect(screen.getByLabelText('widget')).toBeInTheDocument()
    expect(screen.getByText('Priority high')).toBeInTheDocument()
    expect(screen.getByText('Team')).toBeInTheDocument()
    expect(screen.getByText('Subscribe ticket_1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Take' }))
    await waitFor(() => {
      expect(mocks.takeTicketFn).toHaveBeenCalledWith({ data: { ticketId: 'ticket_1' } })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['tickets', 'detail', 'ticket_1'],
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['tickets', 'list'] })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Assigned to you')

    rerender(
      <TicketDetailHeader
        ticket={ticket({ assigneePrincipalId: 'principal_1' as never, visibilityScope: 'custom' })}
        currentPrincipalId={'principal_1' as never}
      />
    )
    expect(screen.getByText('custom')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Return' }))
    await waitFor(() => {
      expect(mocks.returnTicketFn).toHaveBeenCalledWith({ data: { ticketId: 'ticket_1' } })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Returned to team')

    fireEvent.click(screen.getByRole('button', { name: 'Delete ticket' }))
    expect(screen.getByRole('heading', { name: 'Delete ticket?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => {
      expect(mocks.softDeleteTicketFn).toHaveBeenCalledWith({ data: { ticketId: 'ticket_1' } })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Ticket deleted')
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/admin/tickets' })
  })

  it('reports mutation failures', async () => {
    mocks.takeTicketFn.mockRejectedValueOnce(new Error('not allowed'))
    render(<TicketDetailHeader ticket={ticket()} currentPrincipalId={'principal_1' as never} />)

    fireEvent.click(screen.getByRole('button', { name: 'Take' }))

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('not allowed')
    })
  })
})
