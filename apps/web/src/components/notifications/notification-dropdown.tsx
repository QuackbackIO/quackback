'use client'

import { Link, useRouterState } from '@tanstack/react-router'
import { InboxIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { NotificationItem } from './notification-item'
import {
  useNotifications,
  useMarkNotificationAsRead,
  useMarkAllNotificationsAsRead,
} from '@/lib/hooks/use-notifications-queries'

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
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="font-semibold text-sm">Notifications</h3>
        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => markAllAsRead.mutate()}
            disabled={markAllAsRead.isPending}
            className="text-xs h-7 px-2 text-muted-foreground hover:text-foreground"
          >
            Mark all read
          </Button>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-muted-foreground border-t-transparent" />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center h-48">
          <ExclamationTriangleIcon className="h-8 w-8 text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">Failed to load</p>
        </div>
      ) : hasNotifications ? (
        <div className="max-h-80 overflow-hidden">
          <ScrollArea className="max-h-80">
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
      ) : (
        <div className="flex flex-col items-center justify-center h-48">
          <InboxIcon className="h-8 w-8 text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">No notifications yet</p>
        </div>
      )}

      {/* Footer */}
      {hasNotifications && (
        <div className="border-t border-border/40 px-4 py-2.5">
          <Link
            to={isAdminContext ? '/admin/notifications' : '/notifications'}
            onClick={onClose}
            className="block text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            View all
          </Link>
        </div>
      )}
    </div>
  )
}
