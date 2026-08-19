import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useIntl, FormattedMessage } from 'react-intl'
import {
  BellIcon,
  InboxIcon,
  CheckIcon,
  CheckCircleIcon,
  EllipsisHorizontalIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import { EmptyState } from '@/components/shared/empty-state'
import { Spinner } from '@/components/shared/spinner'
import { Button } from '@/components/ui/button'
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
import { useInfiniteNotifications } from '@/lib/client/hooks/use-notifications-queries'
import {
  useMarkNotificationAsRead,
  useMarkAllNotificationsAsRead,
  useArchiveNotification,
  useArchiveAllReadNotifications,
} from '@/lib/client/mutations'
import { NotificationItem } from '@/components/notifications/notification-item'
import { groupNotificationsByDate } from '@/components/notifications/group-by-date'

interface NotificationsSearch {
  filter?: 'unread'
}

export const Route = createFileRoute('/_portal/notifications')({
  // Only the literal 'unread' is accepted — anything else falls back to the
  // default All tab rather than surfacing a broken filter state.
  validateSearch: (search: Record<string, unknown>): NotificationsSearch => ({
    filter: search.filter === 'unread' ? 'unread' : undefined,
  }),
  component: NotificationsPage,
})

function NotificationsPage() {
  const intl = useIntl()
  const navigate = Route.useNavigate()
  const { filter } = Route.useSearch()
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

  const groupLabels: Record<string, string> = {
    today: intl.formatMessage({ id: 'portal.notifications.groupToday', defaultMessage: 'Today' }),
    yesterday: intl.formatMessage({
      id: 'portal.notifications.groupYesterday',
      defaultMessage: 'Yesterday',
    }),
    earlier: intl.formatMessage({
      id: 'portal.notifications.groupEarlier',
      defaultMessage: 'Earlier',
    }),
  }

  return (
    <div className="mx-auto max-w-6xl w-full px-4 sm:px-6 py-8">
      {/* Page Header */}
      <header className="mb-8 animate-in fade-in duration-200 fill-mode-backwards">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <BellIcon className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-foreground tracking-tight">
                <FormattedMessage id="portal.notifications.title" defaultMessage="Notifications" />
                {unreadCount > 0 && (
                  <span className="ms-2.5 inline-flex items-center justify-center h-6 min-w-6 px-2 rounded-full bg-primary text-primary-foreground text-xs font-semibold">
                    {unreadCount}
                  </span>
                )}
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                <FormattedMessage
                  id="portal.notifications.subtitle"
                  defaultMessage="Updates on posts you've subscribed to"
                />
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Tabs
              value={unreadOnly ? 'unread' : 'all'}
              onValueChange={(value) => {
                void navigate({
                  search: (prev) => ({
                    ...prev,
                    filter: value === 'unread' ? 'unread' : undefined,
                  }),
                  replace: true,
                })
              }}
            >
              <TabsList>
                <TabsTrigger value="all">
                  <FormattedMessage id="portal.notifications.tabAll" defaultMessage="All" />
                </TabsTrigger>
                <TabsTrigger value="unread">
                  <FormattedMessage id="portal.notifications.tabUnread" defaultMessage="Unread" />
                  {unreadCount > 0 && (
                    <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold">
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
                className="gap-1.5"
              >
                <CheckIcon className="h-4 w-4" />
                <span className="hidden sm:inline">
                  <FormattedMessage
                    id="portal.notifications.markAllRead"
                    defaultMessage="Mark all read"
                  />
                </span>
                <span className="sm:hidden">
                  <FormattedMessage id="portal.notifications.readAll" defaultMessage="Read all" />
                </span>
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={intl.formatMessage({
                    id: 'portal.notifications.moreActions',
                    defaultMessage: 'More notification actions',
                  })}
                >
                  <EllipsisHorizontalIcon className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setArchiveAllReadOpen(true)}>
                  <FormattedMessage
                    id="portal.notifications.archiveAllRead"
                    defaultMessage="Archive all read"
                  />
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <AlertDialog open={archiveAllReadOpen} onOpenChange={setArchiveAllReadOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <FormattedMessage
                id="portal.notifications.archiveDialog.title"
                defaultMessage="Archive all read notifications?"
              />
            </AlertDialogTitle>
            <AlertDialogDescription>
              <FormattedMessage
                id="portal.notifications.archiveDialog.description"
                defaultMessage="Read notifications will be removed from your list. This can't be undone."
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archiveAllRead.isPending}>
              <FormattedMessage
                id="portal.notifications.archiveDialog.cancel"
                defaultMessage="Cancel"
              />
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => archiveAllRead.mutate()}
              disabled={archiveAllRead.isPending}
            >
              <FormattedMessage
                id="portal.notifications.archiveDialog.confirm"
                defaultMessage="Archive"
              />
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Spinner size="xl" className="border-primary" />
        </div>
      ) : isError ? (
        <div
          className="rounded-xl border border-border/50 bg-card shadow-sm animate-in fade-in duration-200 fill-mode-backwards"
          style={{ animationDelay: '75ms' }}
        >
          <EmptyState
            icon={ExclamationTriangleIcon}
            title={intl.formatMessage({
              id: 'portal.notifications.error.title',
              defaultMessage: 'Failed to load',
            })}
            description={intl.formatMessage({
              id: 'portal.notifications.error.description',
              defaultMessage: "We couldn't load your notifications. Please try again.",
            })}
            action={
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <FormattedMessage id="portal.notifications.error.retry" defaultMessage="Retry" />
              </Button>
            }
            className="py-20 px-6"
          />
        </div>
      ) : notifications.length > 0 ? (
        <div className="space-y-6">
          {groups.map((group, groupIndex) => (
            <section
              key={group.label}
              className="animate-in fade-in duration-200 fill-mode-backwards"
              style={{ animationDelay: `${groupIndex * 75}ms` }}
            >
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 px-1">
                {groupLabels[group.label] ?? group.label}
              </h2>
              <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
                <div className="divide-y divide-border/40">
                  {group.notifications.map((notification, index) => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      variant="full"
                      onMarkAsRead={(id) => markAsRead.mutate(id)}
                      onArchive={(id) => archiveNotification.mutate(id)}
                      className="animate-in fade-in-0 fill-mode-both"
                      style={{
                        animationDelay: `${groupIndex * 100 + index * 50}ms`,
                      }}
                    />
                  ))}
                </div>
              </div>
            </section>
          ))}
          {hasNextPage && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="gap-1.5"
              >
                {isFetchingNextPage && <Spinner size="sm" />}
                <FormattedMessage id="portal.notifications.loadMore" defaultMessage="Load more" />
              </Button>
            </div>
          )}
        </div>
      ) : unreadOnly ? (
        <div
          className="rounded-xl border border-border/50 bg-card shadow-sm animate-in fade-in duration-200 fill-mode-backwards"
          style={{ animationDelay: '75ms' }}
        >
          <EmptyState
            icon={CheckCircleIcon}
            title={intl.formatMessage({
              id: 'portal.notifications.unreadEmpty.title',
              defaultMessage: 'All caught up',
            })}
            description={intl.formatMessage({
              id: 'portal.notifications.unreadEmpty.description',
              defaultMessage: 'No unread notifications.',
            })}
            className="py-20 px-6"
          />
        </div>
      ) : (
        <div
          className="rounded-xl border border-border/50 bg-card shadow-sm animate-in fade-in duration-200 fill-mode-backwards"
          style={{ animationDelay: '75ms' }}
        >
          <EmptyState
            icon={InboxIcon}
            title={intl.formatMessage({
              id: 'portal.notifications.empty.title',
              defaultMessage: 'All caught up!',
            })}
            description={intl.formatMessage({
              id: 'portal.notifications.empty.description',
              defaultMessage:
                "Vote or comment on posts to subscribe. You'll get notified when there are status changes or new activity.",
            })}
            className="py-20 px-6"
          />
        </div>
      )}
    </div>
  )
}
