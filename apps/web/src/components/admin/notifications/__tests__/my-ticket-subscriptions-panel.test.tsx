// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MyTicketSubscriptionsPanel } from '../my-ticket-subscriptions-panel'

type Subscription = {
  id: string
  ticketId: string
  mutedUntil: string | null
  source: string
  ticket: {
    subject: string | null
    priority: string
    updatedAt: string
  }
}

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  fetchNextPage: vi.fn(),
  unsubscribeFromTicketFn: vi.fn(),
  listMyTicketSubscriptionsFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  isLoading: false,
  hasNextPage: false,
  isFetchingNextPage: false,
  pages: [] as Array<{ subscriptions: Subscription[]; nextCursor: unknown }>,
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
  useInfiniteQuery: (options: { queryFn: (args: { pageParam: unknown }) => unknown }) => {
    options.queryFn({ pageParam: null })
    return {
      data: { pages: mocks.pages },
      isLoading: mocks.isLoading,
      hasNextPage: mocks.hasNextPage,
      isFetchingNextPage: mocks.isFetchingNextPage,
      fetchNextPage: mocks.fetchNextPage,
    }
  },
  useMutation: (options: { mutationFn: (ticketId: string) => Promise<unknown> }) => ({
    mutateAsync: (ticketId: string) => options.mutationFn(ticketId),
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
    params: { ticketId: string }
    className?: string
  }) => <a href={to.replace('$ticketId', params.ticketId)}>{children}</a>,
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
    size?: string
    variant?: string
  }) => (
    <button type={type} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    'aria-label': ariaLabel,
  }: {
    checked: boolean | 'indeterminate'
    onCheckedChange: (checked: boolean) => void
    'aria-label'?: string
  }) => (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      data-state={checked === 'indeterminate' ? 'indeterminate' : String(checked)}
      checked={checked === true}
      onChange={() => onCheckedChange(checked !== true)}
    />
  ),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: ReactNode; variant?: string; className?: string }) => (
    <span>{children}</span>
  ),
}))

vi.mock('@/components/shared/empty-state', () => ({
  EmptyState: ({
    title,
    description,
  }: {
    icon: unknown
    title: string
    description: string
    className?: string
  }) => (
    <div>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  ),
}))

vi.mock('@/components/shared/spinner', () => ({
  Spinner: ({ size }: { size?: string }) => <div>Spinner:{size}</div>,
}))

vi.mock('@/components/ui/time-ago', () => ({
  TimeAgo: ({ date }: { date: string }) => <time>{date}</time>,
}))

vi.mock('@/components/admin/tickets/ticket-priority-chip', () => ({
  TicketPriorityChip: ({ priority }: { priority: string }) => <span>priority:{priority}</span>,
}))

vi.mock('@heroicons/react/24/outline', () => ({
  BellIcon: () => <span aria-hidden="true">bell</span>,
  BellSlashIcon: () => <span aria-hidden="true">bell-slash</span>,
}))

vi.mock('@/lib/server/functions/notifications', () => ({
  listMyTicketSubscriptionsFn: mocks.listMyTicketSubscriptionsFn,
  unsubscribeFromTicketFn: mocks.unsubscribeFromTicketFn,
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

function subscription(overrides: Partial<Subscription>): Subscription {
  return {
    id: 'subscription_1',
    ticketId: 'ticket_1',
    mutedUntil: null,
    source: 'manual',
    ticket: {
      subject: 'Printer is down',
      priority: 'normal',
      updatedAt: '2026-06-18T12:00:00.000Z',
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isLoading = false
  mocks.hasNextPage = false
  mocks.isFetchingNextPage = false
  mocks.pages = [
    {
      subscriptions: [
        subscription({ id: 'sub_1', ticketId: 'ticket_1', source: 'manual' }),
        subscription({
          id: 'sub_2',
          ticketId: 'ticket_fail',
          source: 'auto_team_member',
          mutedUntil: '2099-01-01T00:00:00.000Z',
          ticket: {
            subject: null,
            priority: 'urgent',
            updatedAt: '2026-06-18T13:00:00.000Z',
          },
        }),
        subscription({
          id: 'sub_3',
          ticketId: 'ticket_custom',
          source: 'custom_source',
          ticket: {
            subject: 'Custom source ticket',
            priority: 'low',
            updatedAt: '2026-06-18T14:00:00.000Z',
          },
        }),
      ],
      nextCursor: null,
    },
  ]
  mocks.listMyTicketSubscriptionsFn.mockResolvedValue({ subscriptions: [], nextCursor: null })
  mocks.unsubscribeFromTicketFn.mockResolvedValue(undefined)
})

describe('MyTicketSubscriptionsPanel', () => {
  it('renders loading and empty states', () => {
    mocks.isLoading = true
    render(<MyTicketSubscriptionsPanel />)

    expect(screen.getByText('Spinner:xl')).toBeInTheDocument()

    mocks.isLoading = false
    mocks.pages = [{ subscriptions: [], nextCursor: null }]
    const { rerender } = render(<MyTicketSubscriptionsPanel />)
    rerender(<MyTicketSubscriptionsPanel />)

    expect(screen.getByText('No ticket subscriptions yet')).toBeInTheDocument()
    expect(
      screen.getByText('Subscribe to a ticket from its detail page to get notified about updates.')
    ).toBeInTheDocument()
  })

  it('renders subscription labels, muted state and pagination controls', () => {
    mocks.hasNextPage = true
    render(<MyTicketSubscriptionsPanel />)

    expect(mocks.listMyTicketSubscriptionsFn).toHaveBeenCalledWith({
      data: { limit: 50, cursor: undefined },
    })
    expect(screen.getByText('3 subscriptions')).toBeInTheDocument()
    expect(screen.getByText('Printer is down')).toBeInTheDocument()
    expect(screen.getByText('(no subject)')).toBeInTheDocument()
    expect(screen.getByText('Manual')).toBeInTheDocument()
    expect(screen.getByText('Auto · team')).toBeInTheDocument()
    expect(screen.getByText('custom_source')).toBeInTheDocument()
    expect(screen.getByText('priority:urgent')).toBeInTheDocument()
    expect(screen.getByText('muted until')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(mocks.fetchNextPage).toHaveBeenCalledTimes(1)

    mocks.isFetchingNextPage = true
    const { rerender } = render(<MyTicketSubscriptionsPanel />)
    rerender(<MyTicketSubscriptionsPanel />)
    expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled()
  })

  it('selects individual and all subscriptions and bulk unsubscribes successfully', async () => {
    render(<MyTicketSubscriptionsPanel />)

    expect(screen.getByRole('button', { name: 'Unsubscribe selected' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Select ticket Printer is down'))
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    expect(screen.getByLabelText('Select all')).toHaveAttribute('data-state', 'indeterminate')

    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe selected' }))
    await waitFor(() => {
      expect(mocks.unsubscribeFromTicketFn).toHaveBeenCalledWith({
        data: { ticketId: 'ticket_1' },
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['tickets', 'my-subscriptions'],
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Unsubscribed from 1 ticket')

    fireEvent.click(screen.getByLabelText('Select all'))
    expect(screen.getByText('3 selected')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Select all'))
    expect(screen.getByText('3 subscriptions')).toBeInTheDocument()
  })

  it('reports partial bulk unsubscribe failures', async () => {
    mocks.unsubscribeFromTicketFn.mockImplementation(({ data }: { data: { ticketId: string } }) =>
      data.ticketId === 'ticket_fail' ? Promise.reject(new Error('Denied')) : Promise.resolve()
    )

    render(<MyTicketSubscriptionsPanel />)

    fireEvent.click(screen.getByLabelText('Select all'))
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe selected' }))

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Unsubscribed from 2; 1 failed')
    })
  })
})
