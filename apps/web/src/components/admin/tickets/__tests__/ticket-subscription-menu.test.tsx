// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TicketSubscriptionMenu } from '../ticket-subscription-menu'

type Subscription = {
  mutedUntil: string | null
  notifyThreads: boolean
  notifyStatus: boolean
  notifyAssignment: boolean
  notifyParticipants: boolean
  notifyShares: boolean
  notifySla: boolean
}

type MutationOptions<TVars, TResult> = {
  mutationFn: (vars: TVars) => Promise<TResult>
  onSuccess?: (result: TResult) => void
  onError?: (error: Error) => void
}

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  getMyTicketSubscriptionFn: vi.fn(),
  subscribeToTicketFn: vi.fn(),
  unsubscribeFromTicketFn: vi.fn(),
  updateTicketSubscriptionPrefsFn: vi.fn(),
  muteTicketFn: vi.fn(),
  unmuteTicketFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  subscription: null as Subscription | null,
  isLoading: false,
  pending: false,
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
  useQuery: (options: { queryFn: () => unknown }) => {
    options.queryFn()
    return {
      data: mocks.subscription,
      isLoading: mocks.isLoading,
    }
  },
  useMutation: <TVars, TResult>(options: MutationOptions<TVars, TResult>) => ({
    isPending: mocks.pending,
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

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
    'aria-label': ariaLabel,
  }: {
    children: ReactNode
    disabled?: boolean
    variant?: string
    size?: string
    'aria-label'?: string
  }) => (
    <button type="button" disabled={disabled} aria-label={ariaLabel}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuCheckboxItem: ({
    children,
    checked,
    onCheckedChange,
    onSelect,
  }: {
    children: ReactNode
    checked: boolean
    onCheckedChange: (checked: boolean) => void
    onSelect?: (event: { preventDefault: () => void }) => void
  }) => (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={() => {
        onCheckedChange(!checked)
        onSelect?.({ preventDefault: vi.fn() })
      }}
    >
      {children}
    </button>
  ),
  DropdownMenuContent: ({
    children,
  }: {
    children: ReactNode
    align?: string
    className?: string
  }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: ReactNode
    onSelect?: () => void
    className?: string
  }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSubContent: ({ children }: { children: ReactNode; className?: string }) => (
    <div>{children}</div>
  ),
  DropdownMenuSubTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode; asChild?: boolean }) => (
    <>{children}</>
  ),
}))

vi.mock('@heroicons/react/24/outline', () => ({
  BellAlertIcon: () => <span aria-hidden="true">bell-alert</span>,
  BellIcon: () => <span aria-hidden="true">bell</span>,
  BellSlashIcon: () => <span aria-hidden="true">bell-slash</span>,
}))

vi.mock('@heroicons/react/24/solid', () => ({
  BellIcon: () => <span aria-hidden="true">bell-solid</span>,
}))

vi.mock('@/lib/server/functions/notifications', () => ({
  getMyTicketSubscriptionFn: mocks.getMyTicketSubscriptionFn,
  subscribeToTicketFn: mocks.subscribeToTicketFn,
  unsubscribeFromTicketFn: mocks.unsubscribeFromTicketFn,
  updateTicketSubscriptionPrefsFn: mocks.updateTicketSubscriptionPrefsFn,
  muteTicketFn: mocks.muteTicketFn,
  unmuteTicketFn: mocks.unmuteTicketFn,
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    mutedUntil: null,
    notifyThreads: true,
    notifyStatus: false,
    notifyAssignment: true,
    notifyParticipants: false,
    notifyShares: true,
    notifySla: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.subscription = null
  mocks.isLoading = false
  mocks.pending = false
  mocks.getMyTicketSubscriptionFn.mockResolvedValue(mocks.subscription)
  mocks.subscribeToTicketFn.mockResolvedValue(subscription())
  mocks.unsubscribeFromTicketFn.mockResolvedValue(undefined)
  mocks.updateTicketSubscriptionPrefsFn.mockResolvedValue(subscription())
  mocks.muteTicketFn.mockResolvedValue(subscription({ mutedUntil: '2099-01-01T00:00:00.000Z' }))
  mocks.unmuteTicketFn.mockResolvedValue(subscription())
})

describe('TicketSubscriptionMenu', () => {
  it('subscribes when no subscription exists and handles subscribe errors', async () => {
    render(<TicketSubscriptionMenu ticketId={'ticket_1' as never} />)

    expect(screen.getByRole('button', { name: 'Subscribe to ticket' })).toBeEnabled()
    expect(mocks.getMyTicketSubscriptionFn).toHaveBeenCalledWith({
      data: { ticketId: 'ticket_1' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }))
    await waitFor(() => {
      expect(mocks.subscribeToTicketFn).toHaveBeenCalledWith({
        data: { ticketId: 'ticket_1' },
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['tickets', 'my-subscription', 'ticket_1'],
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Subscribed')

    mocks.subscribeToTicketFn.mockRejectedValueOnce(new Error('Subscribe denied'))
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }))
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Subscribe denied')
    })
  })

  it('unsubscribes, updates preferences and mutes subscribed tickets', async () => {
    mocks.subscription = subscription()
    render(<TicketSubscriptionMenu ticketId={'ticket_1' as never} />)

    expect(screen.getByRole('button', { name: 'Subscription menu (subscribed)' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }))
    await waitFor(() => {
      expect(mocks.unsubscribeFromTicketFn).toHaveBeenCalledWith({
        data: { ticketId: 'ticket_1' },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Unsubscribed')

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Status changes' }))
    await waitFor(() => {
      expect(mocks.updateTicketSubscriptionPrefsFn).toHaveBeenCalledWith({
        data: {
          ticketId: 'ticket_1',
          patch: { notifyStatus: true },
        },
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Mute until I unmute' }))
    await waitFor(() => {
      expect(mocks.muteTicketFn).toHaveBeenCalledWith({
        data: { ticketId: 'ticket_1' },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Muted')
  })

  it('unmutes muted subscriptions and reports mutation errors', async () => {
    mocks.subscription = subscription({ mutedUntil: '2099-01-01T00:00:00.000Z' })
    mocks.updateTicketSubscriptionPrefsFn.mockRejectedValueOnce(new Error('Prefs denied'))
    mocks.muteTicketFn.mockRejectedValueOnce(new Error('Mute denied'))
    mocks.unmuteTicketFn.mockRejectedValueOnce(new Error('Unmute denied'))
    mocks.unsubscribeFromTicketFn.mockRejectedValueOnce(new Error('Unsubscribe denied'))

    render(<TicketSubscriptionMenu ticketId={'ticket_1' as never} />)

    expect(screen.getByRole('button', { name: 'Subscription menu (muted)' })).toBeEnabled()

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'New replies' }))
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Prefs denied')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Mute for 1 hour' }))
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Mute denied')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }))
    await waitFor(() => {
      expect(mocks.unmuteTicketFn).toHaveBeenCalledWith({
        data: { ticketId: 'ticket_1' },
      })
    })
    expect(mocks.toastError).toHaveBeenCalledWith('Unmute denied')

    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }))
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Unsubscribe denied')
    })
  })

  it('disables the trigger while loading or any mutation is pending', () => {
    mocks.isLoading = true
    const { rerender } = render(<TicketSubscriptionMenu ticketId={'ticket_1' as never} />)

    expect(screen.getByRole('button', { name: 'Subscribe to ticket' })).toBeDisabled()

    mocks.isLoading = false
    mocks.pending = true
    rerender(<TicketSubscriptionMenu ticketId={'ticket_1' as never} />)

    expect(screen.getByRole('button', { name: 'Subscribe to ticket' })).toBeDisabled()
  })
})
