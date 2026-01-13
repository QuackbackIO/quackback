import { createFileRoute } from '@tanstack/react-router'
import { BellIcon, InboxIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { NotificationItem } from '@/components/notifications/notification-item'
import {
  useNotifications,
  useMarkNotificationAsRead,
  useMarkAllNotificationsAsRead,
} from '@/lib/hooks/use-notifications-queries'

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
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 bg-card/50">
        <div className="flex items-center gap-3">
          <BellIcon className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Notifications</h1>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              {total} total
            </Badge>
            {unreadCount > 0 && (
              <Badge variant="default" className="text-xs">
                {unreadCount} unread
              </Badge>
            )}
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
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-muted-foreground border-t-transparent" />
        </div>
      ) : notifications.length > 0 ? (
        <ScrollArea className="flex-1">
          <div className="divide-y divide-border/40">
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
        <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
          <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
            <InboxIcon className="h-8 w-8 text-muted-foreground/70" />
          </div>
          <h3 className="text-base font-medium text-muted-foreground">No notifications yet</h3>
          <p className="text-sm text-muted-foreground/70 mt-1 max-w-md">
            You'll see notifications here when there are status changes or new comments on posts
            you're subscribed to.
          </p>
        </div>
      )}
    </div>
  )
}
