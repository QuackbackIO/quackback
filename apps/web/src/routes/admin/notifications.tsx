import { createFileRoute } from '@tanstack/react-router'
import { InboxIcon } from '@heroicons/react/24/outline'
import { BellIcon as BellIconSolid } from '@heroicons/react/24/solid'
import { EmptyState } from '@/components/shared/empty-state'
import { Spinner } from '@/components/shared/spinner'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { NotificationItem } from '@/components/notifications/notification-item'
import { useNotifications } from '@/lib/client/hooks/use-notifications-queries'
import { useMarkNotificationAsRead, useMarkAllNotificationsAsRead } from '@/lib/client/mutations'

export const Route = createFileRoute('/admin/notifications')({
  component: NotificationsPage,
})

function NotificationsPage() {
  const { data, isLoading } = useNotifications({ limit: 50 })
  const markAsRead = useMarkNotificationAsRead()
  const markAllAsRead = useMarkAllNotificationsAsRead()

  const notifications = data?.notifications ?? []
  const unreadCount = data?.unreadCount ?? 0
  const total = data?.total ?? 0

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <BellIconSolid className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Notifications</h1>
            <p className="text-xs text-muted-foreground">
              {total === 0
                ? 'No notifications'
                : unreadCount > 0
                  ? `${unreadCount} unread of ${total}`
                  : `${total} notifications — all caught up`}
            </p>
          </div>
        </div>
        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => markAllAsRead.mutate()}
            disabled={markAllAsRead.isPending}
          >
            Mark all as read
          </Button>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Spinner size="xl" />
        </div>
      ) : notifications.length > 0 ? (
        <ScrollArea className="flex-1">
          <div className="divide-y divide-border/50">
            {notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onMarkAsRead={(id) => markAsRead.mutate(id)}
                variant="full"
              />
            ))}
          </div>
        </ScrollArea>
      ) : (
        <EmptyState
          icon={InboxIcon}
          title="No notifications yet"
          description="You'll see notifications here when there are status changes or new comments on posts you're subscribed to."
          className="py-24"
        />
      )}
    </div>
  )
}
