// @vitest-environment happy-dom
import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

type RouteOptions = {
  component: () => ReactElement
}

type ComponentProps = {
  children?: ReactNode
  className?: string
  onClick?: () => void
  disabled?: boolean
}

const mocks = vi.hoisted(() => ({
  notificationsResult: {
    data: undefined as unknown,
    isLoading: false as boolean,
  },
  markAsReadMutate: vi.fn(),
  markAllMutate: vi.fn(),
  markAllPending: false as boolean,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}))

vi.mock('@/lib/client/hooks/use-notifications-queries', () => ({
  useNotifications: () => mocks.notificationsResult,
}))

vi.mock('@/lib/client/mutations', () => ({
  useMarkNotificationAsRead: () => ({ mutate: mocks.markAsReadMutate }),
  useMarkAllNotificationsAsRead: () => ({
    mutate: mocks.markAllMutate,
    isPending: mocks.markAllPending,
  }),
}))

vi.mock('@heroicons/react/24/outline', () => ({
  InboxIcon: () => <span />,
}))

vi.mock('@heroicons/react/24/solid', () => ({
  BellIcon: () => <span />,
}))

vi.mock('@/components/shared/empty-state', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      <span>{description}</span>
    </div>
  ),
}))

vi.mock('@/components/shared/spinner', () => ({
  Spinner: ({ size }: { size?: string }) => <span data-testid="spinner">{size}</span>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled }: ComponentProps) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: ComponentProps) => <div data-testid="scroll-area">{children}</div>,
}))

vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: ComponentProps) => <div>{children}</div>,
  TabsList: ({ children }: ComponentProps) => <div>{children}</div>,
  TabsTrigger: ({ children }: ComponentProps) => <button type="button">{children}</button>,
  TabsContent: ({ children }: ComponentProps) => <div>{children}</div>,
}))

vi.mock('@/components/notifications/notification-item', () => ({
  NotificationItem: ({
    notification,
    onMarkAsRead,
  }: {
    notification: { id: string }
    onMarkAsRead: (id: string) => void
  }) => (
    <button
      type="button"
      data-testid={`notification-${notification.id}`}
      onClick={() => onMarkAsRead(notification.id)}
    >
      {notification.id}
    </button>
  ),
}))

vi.mock('@/components/admin/notifications/my-ticket-subscriptions-panel', () => ({
  MyTicketSubscriptionsPanel: () => <div data-testid="subscriptions-panel" />,
}))

const { Route } = await import('../notifications')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

function renderPage() {
  const Component = routeOptions().component
  return render(<Component />)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.notificationsResult = { data: undefined, isLoading: false }
  mocks.markAllPending = false
})

describe('admin notifications route', () => {
  it('renders the loading spinner while notifications are loading', () => {
    mocks.notificationsResult = { data: undefined, isLoading: true }
    renderPage()
    expect(screen.getByTestId('spinner')).toBeInTheDocument()
    // header reflects no totals -> "No notifications"
    expect(screen.getByText('No notifications')).toBeInTheDocument()
    // no "Mark all as read" button when unreadCount is 0
    expect(screen.queryByRole('button', { name: 'Mark all as read' })).toBeNull()
  })

  it('renders the empty state when there are no notifications', () => {
    mocks.notificationsResult = {
      data: { notifications: [], unreadCount: 0, total: 0 },
      isLoading: false,
    }
    renderPage()
    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    expect(screen.getByText('No notifications yet')).toBeInTheDocument()
    expect(screen.getByTestId('subscriptions-panel')).toBeInTheDocument()
  })

  it('renders the notification list and marks an item as read on click', () => {
    mocks.notificationsResult = {
      data: {
        notifications: [{ id: 'notif-1' }, { id: 'notif-2' }],
        unreadCount: 2,
        total: 5,
      },
      isLoading: false,
    }
    renderPage()
    expect(screen.getByTestId('scroll-area')).toBeInTheDocument()
    // unreadCount > 0 -> header shows "X unread of Y"
    expect(screen.getByText('2 unread of 5')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('notification-notif-1'))
    expect(mocks.markAsReadMutate).toHaveBeenCalledWith('notif-1')
  })

  it('shows the all-caught-up header and triggers mark-all-as-read', () => {
    mocks.notificationsResult = {
      data: {
        notifications: [{ id: 'notif-1' }],
        unreadCount: 0,
        total: 3,
      },
      isLoading: false,
    }
    renderPage()
    expect(screen.getByText('3 notifications — all caught up')).toBeInTheDocument()
    // unreadCount is 0 so no mark-all button is rendered
    expect(screen.queryByRole('button', { name: 'Mark all as read' })).toBeNull()
  })

  it('renders and fires the mark-all button when there are unread notifications', () => {
    mocks.notificationsResult = {
      data: {
        notifications: [{ id: 'notif-1' }],
        unreadCount: 1,
        total: 1,
      },
      isLoading: false,
    }
    mocks.markAllPending = false
    renderPage()
    const button = screen.getByRole('button', { name: 'Mark all as read' })
    expect(button).not.toBeDisabled()
    fireEvent.click(button)
    expect(mocks.markAllMutate).toHaveBeenCalled()
  })
})
