// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { NotificationItem } from '../notification-item'

const mocks = vi.hoisted(() => ({
  pathname: '/admin/dashboard',
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    search,
    onClick,
  }: {
    children: ReactNode
    to: string
    params?: Record<string, string>
    search?: Record<string, string>
    onClick?: () => void
  }) => (
    <a
      href={`${to}:${JSON.stringify(params ?? {})}:${JSON.stringify(search ?? {})}`}
      onClick={(event) => {
        event.preventDefault()
        onClick?.()
      }}
    >
      {children}
    </a>
  ),
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => string }) =>
    select({ location: { pathname: mocks.pathname } }),
}))

vi.mock('date-fns', () => ({
  formatDistanceToNow: () => '2 minutes ago',
}))

vi.mock('../notification-type-config', () => ({
  getNotificationTypeConfig: (type: string) => ({
    bgClass: `bg-${type}`,
    iconClass: `text-${type}`,
    icon: ({ className }: { className?: string }) => <span className={className}>icon</span>,
  }),
}))

function notification(overrides: Record<string, unknown> = {}) {
  return {
    id: 'notification_1',
    type: 'ticket_assigned',
    title: 'Assigned to you',
    body: 'A ticket needs attention',
    readAt: null,
    createdAt: '2026-06-20T10:00:00.000Z',
    ticketId: null,
    postId: null,
    post: null,
    conversationId: null,
    ...overrides,
  } as never
}

beforeEach(() => {
  mocks.pathname = '/admin/dashboard'
})

describe('NotificationItem', () => {
  it('links ticket notifications and marks unread items as read', () => {
    const onMarkAsRead = vi.fn()
    const onClick = vi.fn()
    render(
      <NotificationItem
        notification={notification({ ticketId: 'ticket_1' })}
        onMarkAsRead={onMarkAsRead}
        onClick={onClick}
      />
    )

    const link = screen.getByRole('link', { name: /Assigned to you/ })
    expect(link).toHaveAttribute('href', expect.stringContaining('/admin/tickets/$ticketId'))
    expect(link).toHaveAttribute('href', expect.stringContaining('ticket_1'))
    expect(screen.getByText('A ticket needs attention')).toBeInTheDocument()
    expect(screen.getByText('2 minutes ago')).toBeInTheDocument()

    fireEvent.click(link)
    expect(onMarkAsRead).toHaveBeenCalledWith('notification_1')
    expect(onClick).toHaveBeenCalled()
  })

  it('links post and chat mention notifications', () => {
    const { rerender } = render(
      <NotificationItem
        notification={notification({
          type: 'post_mentioned',
          postId: 'post_1',
          post: { boardSlug: 'roadmap', title: 'Public roadmap' },
          readAt: '2026-06-20T11:00:00.000Z',
        })}
      />
    )

    expect(screen.getByRole('link', { name: /Assigned to you/ })).toHaveAttribute(
      'href',
      expect.stringContaining('/b/$slug/posts/$postId')
    )

    rerender(
      <NotificationItem
        notification={notification({
          type: 'chat_mention',
          title: 'Mentioned in chat',
          conversationId: 'conversation_1',
        })}
      />
    )

    expect(screen.getByRole('link', { name: /Mentioned in chat/ })).toHaveAttribute(
      'href',
      expect.stringContaining('/admin/inbox')
    )
    expect(screen.getByRole('link', { name: /Mentioned in chat/ })).toHaveAttribute(
      'href',
      expect.stringContaining('conversation_1')
    )
  })

  it('uses admin/public fallback links and full variant click handling', () => {
    const onMarkAsRead = vi.fn()
    const { rerender } = render(<NotificationItem notification={notification()} />)

    expect(screen.getByRole('link', { name: /Assigned to you/ })).toHaveAttribute(
      'href',
      expect.stringContaining('/admin/notifications')
    )

    mocks.pathname = '/roadmap'
    rerender(<NotificationItem notification={notification({ title: 'Public notice' })} />)
    expect(screen.getByRole('link', { name: /Public notice/ })).toHaveAttribute(
      'href',
      expect.stringContaining('/notifications')
    )

    rerender(
      <NotificationItem
        notification={notification({
          title: 'Full notice',
          post: { boardSlug: 'roadmap', title: 'Roadmap source' },
        })}
        onMarkAsRead={onMarkAsRead}
        variant="full"
      />
    )

    expect(screen.getByText('Roadmap source')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Full notice').closest('div') as HTMLElement)
    expect(onMarkAsRead).toHaveBeenCalledWith('notification_1')
  })
})
