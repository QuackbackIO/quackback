import { createFileRoute, Link } from '@tanstack/react-router'
import { BellIcon, InboxIcon, CheckIcon } from '@heroicons/react/24/outline'
import { formatDistanceToNow, isToday, isYesterday, format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  useNotifications,
  useMarkNotificationAsRead,
  useMarkAllNotificationsAsRead,
  type SerializedNotification,
} from '@/lib/hooks/use-notifications-queries'
import { getNotificationTypeConfig } from '@/components/notifications/notification-type-config'

export const Route = createFileRoute('/_portal/notifications')({
  component: NotificationsPage,
})

/** Group notifications by time period for better scannability */
function groupNotificationsByDate(notifications: SerializedNotification[]) {
  const groups: { label: string; notifications: SerializedNotification[] }[] = []
  const today: SerializedNotification[] = []
  const yesterday: SerializedNotification[] = []
  const earlier: SerializedNotification[] = []

  for (const notification of notifications) {
    const date = new Date(notification.createdAt)
    if (isToday(date)) {
      today.push(notification)
    } else if (isYesterday(date)) {
      yesterday.push(notification)
    } else {
      earlier.push(notification)
    }
  }

  if (today.length > 0) groups.push({ label: 'Today', notifications: today })
  if (yesterday.length > 0) groups.push({ label: 'Yesterday', notifications: yesterday })
  if (earlier.length > 0) groups.push({ label: 'Earlier', notifications: earlier })

  return groups
}

function NotificationsPage() {
  const { data, isLoading } = useNotifications({ limit: 50 })
  const markAsRead = useMarkNotificationAsRead()
  const markAllAsRead = useMarkAllNotificationsAsRead()

  const notifications = data?.notifications ?? []
  const unreadCount = data?.unreadCount ?? 0
  const groups = groupNotificationsByDate(notifications)

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 sm:px-6">
      {/* Page Header */}
      <header className="mb-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <BellIcon className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-foreground tracking-tight">
                Notifications
                {unreadCount > 0 && (
                  <span className="ml-2.5 inline-flex items-center justify-center h-6 min-w-6 px-2 rounded-full bg-primary text-primary-foreground text-xs font-semibold">
                    {unreadCount}
                  </span>
                )}
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Updates on posts you've subscribed to
              </p>
            </div>
          </div>
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAllAsRead.mutate()}
              disabled={markAllAsRead.isPending}
              className="shrink-0 gap-1.5"
            >
              <CheckIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Mark all read</span>
              <span className="sm:hidden">Read all</span>
            </Button>
          )}
        </div>
      </header>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
        </div>
      ) : notifications.length > 0 ? (
        <div className="space-y-6">
          {groups.map((group, groupIndex) => (
            <section key={group.label}>
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 px-1">
                {group.label}
              </h2>
              <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
                <div className="divide-y divide-border/40">
                  {group.notifications.map((notification, index) => (
                    <NotificationRow
                      key={notification.id}
                      notification={notification}
                      onMarkAsRead={(id) => markAsRead.mutate(id)}
                      style={{
                        animationDelay: `${groupIndex * 100 + index * 50}ms`,
                      }}
                    />
                  ))}
                </div>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-border/50 bg-card shadow-sm">
          <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-muted/60 flex items-center justify-center mb-5">
              <InboxIcon className="h-8 w-8 text-muted-foreground/60" />
            </div>
            <h3 className="text-lg font-medium text-foreground">All caught up!</h3>
            <p className="text-sm text-muted-foreground mt-2 max-w-xs leading-relaxed">
              Vote or comment on posts to subscribe. You'll get notified when there are status
              changes or new activity.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

interface NotificationRowProps {
  notification: SerializedNotification
  onMarkAsRead: (id: SerializedNotification['id']) => void
  style?: React.CSSProperties
}

function NotificationRow({ notification, onMarkAsRead, style }: NotificationRowProps) {
  const config = getNotificationTypeConfig(notification.type)
  const Icon = config.icon
  const isUnread = !notification.readAt
  const createdAt = new Date(notification.createdAt)

  function handleClick(): void {
    if (isUnread) {
      onMarkAsRead(notification.id)
    }
  }

  const content = (
    <div
      className={cn(
        'group relative flex items-start gap-4 px-4 sm:px-5 py-4 transition-all duration-200',
        'hover:bg-muted/40',
        'animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-both',
        isUnread && 'bg-primary/[0.02]'
      )}
      style={style}
    >
      {/* Unread accent bar */}
      {isUnread && <div className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full bg-primary" />}

      {/* Icon */}
      <div
        className={cn(
          'flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-transform duration-200 group-hover:scale-105',
          config.bgClass
        )}
      >
        <Icon className={cn('h-5 w-5', config.iconClass)} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 py-0.5">
        <p
          className={cn(
            'text-sm leading-snug',
            isUnread ? 'font-medium text-foreground' : 'text-foreground/90'
          )}
        >
          {notification.title}
        </p>
        {notification.body && (
          <p className="text-sm text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
            {notification.body}
          </p>
        )}
        <div className="flex items-center gap-2 mt-2">
          {notification.post && (
            <>
              <span className="text-xs text-muted-foreground/70 truncate max-w-[200px]">
                {notification.post.title}
              </span>
              <span className="text-muted-foreground/40">·</span>
            </>
          )}
          <time
            className="text-xs text-muted-foreground/70 whitespace-nowrap"
            dateTime={createdAt.toISOString()}
          >
            {isToday(createdAt)
              ? formatDistanceToNow(createdAt, { addSuffix: true })
              : format(createdAt, 'MMM d, h:mm a')}
          </time>
        </div>
      </div>

      {/* Unread dot */}
      {isUnread && (
        <div className="flex-shrink-0 w-2.5 h-2.5 rounded-full bg-primary mt-2 ring-4 ring-primary/10" />
      )}
    </div>
  )

  if (notification.post && notification.postId) {
    return (
      <Link
        to="/b/$slug/posts/$postId"
        params={{ slug: notification.post.boardSlug, postId: notification.postId }}
        onClick={handleClick}
        className="block"
      >
        {content}
      </Link>
    )
  }

  return (
    <div onClick={handleClick} className="cursor-default">
      {content}
    </div>
  )
}
