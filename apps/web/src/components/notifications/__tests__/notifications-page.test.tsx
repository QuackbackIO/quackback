// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render as baseRender, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import en from '@/locales/en.json'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const navigate = vi.fn()
let search: { filter?: 'unread' } = {}
const markAll = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useNavigate: () => navigate,
    useSearch: () => search,
  }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

const page = {
  unreadCount: 2,
  total: 3,
  notifications: [
    {
      id: 'n1',
      title: 'New message from Anonymous',
      body: 'hello',
      createdAt: '2020-01-01T10:00:00.000Z',
      readAt: null,
    },
  ],
}
let pageData = page

vi.mock('@/lib/client/hooks/use-notifications-queries', () => ({
  useInfiniteNotifications: () => ({
    data: { pages: [pageData] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
}))
vi.mock('@/lib/client/mutations', () => ({
  useMarkNotificationAsRead: () => ({ mutate: vi.fn() }),
  useMarkAllNotificationsAsRead: () => ({ mutate: markAll, isPending: false }),
  useArchiveNotification: () => ({ mutate: vi.fn() }),
  useArchiveAllReadNotifications: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/components/notifications/notification-item', () => ({
  NotificationItem: ({ notification }: { notification: { title: string } }) => (
    <div>{notification.title}</div>
  ),
}))

const { NotificationsPage } = await import('../notifications-page')

beforeEach(() => {
  navigate.mockClear()
  markAll.mockClear()
  search = {}
  pageData = page
})

// Admin renders the page under its IntlProvider; the whole catalog holds the
// notification text, so the list renders at once instead of loading it.
function render(ui: React.ReactElement) {
  return baseRender(
    <IntlProvider locale="en" defaultLocale="en" messages={en}>
      {ui}
    </IntlProvider>
  )
}

describe('notifications page', () => {
  it('uses the standard page header with a labelled Mark all as read button', () => {
    const { container } = render(<NotificationsPage />)
    expect(container.querySelector('[data-page-header]')).not.toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Notifications' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }))
    expect(markAll).toHaveBeenCalledTimes(1)
  })

  it('keeps Mark all as read visible but disabled when nothing is unread', () => {
    pageData = { ...page, unreadCount: 0 }
    render(<NotificationsPage />)
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled()
  })

  it('has no summary line joining the counts with a dash', () => {
    pageData = { ...page, unreadCount: 0 }
    render(<NotificationsPage />)
    expect(screen.queryByText(/all caught up/i)).toBeNull()
    expect(document.body.textContent).not.toMatch(/[–—]/)
  })

  it('switches to the Unread filter through line tabs under the header', () => {
    render(<NotificationsPage />)
    const header = document.querySelector('[data-page-header]')!
    const tab = screen.getByRole('tab', { name: /^Unread/ })
    expect(header.compareDocumentPosition(tab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'All' }).closest('[data-variant="line"]')).not.toBeNull()
    fireEvent.click(tab)
    expect(navigate).toHaveBeenCalledTimes(1)
    const { search: update, replace } = navigate.mock.calls[0][0]
    expect(replace).toBe(true)
    expect(update({})).toEqual({ filter: 'unread' })
  })

  it('returns to the default tab by dropping the filter', () => {
    search = { filter: 'unread' }
    render(<NotificationsPage />)
    fireEvent.click(screen.getByRole('tab', { name: 'All' }))
    const { search: update } = navigate.mock.calls[0][0]
    expect(update({ filter: 'unread' })).toEqual({ filter: undefined })
  })

  it('shows the unread count on the Unread tab', () => {
    render(<NotificationsPage />)
    expect(screen.getByRole('tab', { name: 'Unread 2' })).toBeInTheDocument()
  })

  it('shows no count on the Unread tab when nothing is unread', () => {
    pageData = { ...page, unreadCount: 0 }
    render(<NotificationsPage />)
    expect(screen.getByRole('tab', { name: 'Unread' })).toBeInTheDocument()
  })

  it('labels the date group in sentence case and keeps the list form width', () => {
    const { container } = render(<NotificationsPage />)
    const label = screen.getByText('Earlier')
    expect(label.className).not.toMatch(/uppercase/)
    expect(container.querySelector('.max-w-3xl')).not.toBeNull()
  })
})
