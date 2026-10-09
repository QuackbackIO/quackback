'use client'

import { lazy, Suspense } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { FormattedMessage } from 'react-intl'
import { InboxIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { Spinner } from '@/components/shared/spinner'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { NotificationItem } from './notification-item'
import { useNotifications } from '@/lib/client/hooks/use-notifications-queries'
import {
  useMarkNotificationAsRead,
  useMarkAllNotificationsAsRead,
} from '@/lib/client/mutations/notifications'

// The bell sits on every admin and portal page, so the module that loads the
// titles' strings is fetched with the list rather than with each page.
const AreaMessages = lazy(() =>
  import('@/components/shared/area-messages').then((m) => ({ default: m.AreaMessages }))
)

const listLoading = (
  <div className="flex items-center justify-center h-48">
    <Spinner />
  </div>
)

interface NotificationDropdownProps {
  onClose?: () => void
}

export function NotificationDropdown({ onClose }: NotificationDropdownProps) {
  const { data, isLoading, isError } = useNotifications({ limit: 10 })
  const markAsRead = useMarkNotificationAsRead()
  const markAllAsRead = useMarkAllNotificationsAsRead()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  const notifications = data?.notifications ?? []
  const unreadCount = data?.unreadCount ?? 0
  const hasNotifications = notifications.length > 0
  const isAdminContext = pathname.startsWith('/admin')

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5">
        <h3 className="font-semibold text-sm">
          <FormattedMessage id="portal.notifications.title" defaultMessage="Notifications" />
        </h3>
        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => markAllAsRead.mutate()}
            disabled={markAllAsRead.isPending}
            className="text-xs h-7 px-2 text-muted-foreground hover:text-foreground"
          >
            <FormattedMessage
              id="portal.notifications.markAllRead"
              defaultMessage="Mark all read"
            />
          </Button>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        listLoading
      ) : isError ? (
        <div className="flex flex-col items-center justify-center h-48">
          <ExclamationTriangleIcon className="h-8 w-8 text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">
            <FormattedMessage
              id="portal.notifications.error.title"
              defaultMessage="Failed to load"
            />
          </p>
        </div>
      ) : hasNotifications ? (
        <Suspense fallback={listLoading}>
          <AreaMessages area="notificationText" fallback={listLoading}>
            <div className="max-h-72 overflow-hidden">
              <ScrollArea className="max-h-72">
                <div className="divide-y divide-border/40">
                  {notifications.map((notification) => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      onMarkAsRead={(id) => markAsRead.mutate(id)}
                      onClick={onClose}
                    />
                  ))}
                </div>
              </ScrollArea>
            </div>
          </AreaMessages>
        </Suspense>
      ) : (
        <div className="flex flex-col items-center justify-center h-48">
          <InboxIcon className="h-8 w-8 text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">
            <FormattedMessage
              id="portal.notifications.dropdown.empty"
              defaultMessage="No notifications yet"
            />
          </p>
        </div>
      )}

      {/* Footer */}
      {hasNotifications && (
        <div className="border-t border-border/40 px-3 py-2">
          <Link
            to={isAdminContext ? '/admin/notifications' : '/notifications'}
            onClick={onClose}
            className="block text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <FormattedMessage
              id="portal.notifications.dropdown.viewAll"
              defaultMessage="View all"
            />
          </Link>
        </div>
      )}
    </div>
  )
}
