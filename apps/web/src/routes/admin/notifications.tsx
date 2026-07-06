import { createFileRoute } from '@tanstack/react-router'
import { InboxIcon, CheckCircleIcon } from '@heroicons/react/24/outline'
import { BellIcon as BellIconSolid } from '@heroicons/react/24/solid'
import { EmptyState } from '@/components/shared/empty-state'
import { Spinner } from '@/components/shared/spinner'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { NotificationItem } from '@/components/notifications/notification-item'
import { useInfiniteNotifications } from '@/lib/client/hooks/use-notifications-queries'
import { useMarkNotificationAsRead, useMarkAllNotificationsAsRead } from '@/lib/client/mutations'
import {
  groupNotificationsByDate,
  type NotificationDateGroupKey,
} from '@/components/notifications/group-by-date'

const GROUP_LABELS: Record<NotificationDateGroupKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  earlier: 'Earlier',
}

interface NotificationsSearch {
  filter?: 'unread'
}

export const Route = createFileRoute('/admin/notifications')({
  // Only the literal 'unread' is accepted — anything else falls back to the
  // default All tab rather than surfacing a broken filter state.
  validateSearch: (search: Record<string, unknown>): NotificationsSearch => ({
    filter: search.filter === 'unread' ? 'unread' : undefined,
  }),
  component: NotificationsPage,
})

function NotificationsPage() {
  const navigate = Route.useNavigate()
  const { filter } = Route.useSearch()
  const unreadOnly = filter === 'unread'
  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useInfiniteNotifications({ unreadOnly })
  const markAsRead = useMarkNotificationAsRead()
  const markAllAsRead = useMarkAllNotificationsAsRead()

  const notifications = data?.pages.flatMap((page) => page.notifications) ?? []
  const unreadCount = data?.pages[0]?.unreadCount ?? 0
  const total = data?.pages[0]?.total ?? 0
  const groups = groupNotificationsByDate(notifications)

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
        <div className="flex items-center gap-3">
          <Tabs
            value={filter === 'unread' ? 'unread' : 'all'}
            onValueChange={(value) => {
              void navigate({
                search: (prev) => ({ ...prev, filter: value === 'unread' ? 'unread' : undefined }),
                replace: true,
              })
            }}
          >
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="unread">
                Unread
                {unreadCount > 0 && (
                  <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold">
                    {unreadCount}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>
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
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Spinner size="xl" />
        </div>
      ) : notifications.length > 0 ? (
        <ScrollArea className="flex-1">
          <div className="space-y-4 px-6 py-4">
            {groups.map((group) => (
              <div key={group.label}>
                <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  {GROUP_LABELS[group.label]}
                </h2>
                <div className="divide-y divide-border/50">
                  {group.notifications.map((notification) => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      onMarkAsRead={(id) => markAsRead.mutate(id)}
                      variant="full"
                    />
                  ))}
                </div>
              </div>
            ))}
            {hasNextPage && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage && <Spinner size="sm" />}
                  Load more
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>
      ) : unreadOnly ? (
        <EmptyState
          icon={CheckCircleIcon}
          title="All caught up"
          description="No unread notifications."
          className="py-24"
        />
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
