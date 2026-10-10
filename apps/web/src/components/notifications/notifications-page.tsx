import { useState } from 'react'
import { getRouteApi } from '@tanstack/react-router'
import {
  InboxIcon,
  CheckCircleIcon,
  EllipsisHorizontalIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { Spinner } from '@/components/shared/spinner'
import { AreaMessages } from '@/components/shared/area-messages'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { NotificationItem } from '@/components/notifications/notification-item'
import { useInfiniteNotifications } from '@/lib/client/hooks/use-notifications-queries'
import {
  useMarkNotificationAsRead,
  useMarkAllNotificationsAsRead,
  useArchiveNotification,
  useArchiveAllReadNotifications,
} from '@/lib/client/mutations'
import {
  groupNotificationsByDate,
  type NotificationDateGroupKey,
} from '@/components/notifications/group-by-date'

const GROUP_LABELS: Record<NotificationDateGroupKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  earlier: 'Earlier',
}

const route = getRouteApi('/admin/notifications')

export function NotificationsPage() {
  const navigate = route.useNavigate()
  const { filter } = route.useSearch()
  const unreadOnly = filter === 'unread'
  const [archiveAllReadOpen, setArchiveAllReadOpen] = useState(false)
  const { data, isLoading, isError, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useInfiniteNotifications({ unreadOnly })
  const markAsRead = useMarkNotificationAsRead()
  const markAllAsRead = useMarkAllNotificationsAsRead()
  const archiveNotification = useArchiveNotification()
  const archiveAllRead = useArchiveAllReadNotifications()

  const notifications = data?.pages.flatMap((page) => page.notifications) ?? []
  const unreadCount = data?.pages[0]?.unreadCount ?? 0
  const groups = groupNotificationsByDate(notifications)

  return (
    <ScrollArea className="h-full">
      <div className="px-4 pt-4 pb-16 sm:px-6">
        <div className="w-full max-w-3xl space-y-4">
          <PageHeader
            title="Notifications"
            actions={
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => markAllAsRead.mutate()}
                  disabled={unreadCount === 0 || markAllAsRead.isPending}
                >
                  Mark all as read
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="More notification actions">
                      <EllipsisHorizontalIcon className="h-5 w-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setArchiveAllReadOpen(true)}>
                      Archive all read
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            }
          />

          <Tabs
            value={filter === 'unread' ? 'unread' : 'all'}
            onValueChange={(value) => {
              void navigate({
                search: (prev) => ({ ...prev, filter: value === 'unread' ? 'unread' : undefined }),
                replace: true,
              })
            }}
            variant="line"
          >
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="unread">
                Unread
                {unreadCount > 0 && (
                  <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                    {unreadCount}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <AlertDialog open={archiveAllReadOpen} onOpenChange={setArchiveAllReadOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Archive all read notifications?</AlertDialogTitle>
                <AlertDialogDescription>
                  Read notifications will be removed from your list. This can't be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={archiveAllRead.isPending}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => archiveAllRead.mutate()}
                  disabled={archiveAllRead.isPending}
                >
                  Archive
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Content */}
          {isLoading ? (
            <div className="flex items-center justify-center py-24">
              <Spinner size="xl" />
            </div>
          ) : isError ? (
            <EmptyState
              icon={ExclamationTriangleIcon}
              title="Failed to load"
              description="We couldn't load your notifications. Please try again."
              action={
                <Button variant="outline" size="sm" onClick={() => refetch()}>
                  Retry
                </Button>
              }
              className="py-24"
            />
          ) : notifications.length > 0 ? (
            <AreaMessages
              area="notificationText"
              fallback={
                <div className="flex items-center justify-center py-24">
                  <Spinner size="xl" />
                </div>
              }
            >
              <div className="space-y-4">
                {groups.map((group) => (
                  <div key={group.label}>
                    <h2 className="mb-2 text-[13px] font-medium text-muted-foreground">
                      {GROUP_LABELS[group.label]}
                    </h2>
                    <div className="divide-y divide-border/50">
                      {group.notifications.map((notification) => (
                        <NotificationItem
                          key={notification.id}
                          notification={notification}
                          onMarkAsRead={(id) => markAsRead.mutate(id)}
                          onArchive={(id) => archiveNotification.mutate(id)}
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
            </AreaMessages>
          ) : unreadOnly ? (
            <EmptyState
              icon={CheckCircleIcon}
              title="Nothing to review"
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
      </div>
    </ScrollArea>
  )
}
