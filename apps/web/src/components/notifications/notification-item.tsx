'use client'

import { Link, useRouterState } from '@tanstack/react-router'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'
import { getNotificationTypeConfig } from './notification-type-config'
import type { SerializedNotification } from '@/lib/hooks/use-notifications-queries'

interface NotificationItemProps {
  notification: SerializedNotification
  onMarkAsRead?: (id: SerializedNotification['id']) => void
  onClick?: () => void
  /** Layout variant: 'compact' for dropdown, 'full' for page view */
  variant?: 'compact' | 'full'
}

export function NotificationItem({
  notification,
  onMarkAsRead,
  onClick,
  variant = 'compact',
}: NotificationItemProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  const config = getNotificationTypeConfig(notification.type)
  const Icon = config.icon
  const isUnread = !notification.readAt
  const isFullVariant = variant === 'full'

  function handleClick(): void {
    if (isUnread && onMarkAsRead) {
      onMarkAsRead(notification.id)
    }
    onClick?.()
  }

  const content = isFullVariant ? (
    <FullContent
      notification={notification}
      icon={Icon}
      iconClass={config.iconClass}
      bgClass={config.bgClass}
      isUnread={isUnread}
    />
  ) : (
    <CompactContent
      notification={notification}
      icon={Icon}
      iconClass={config.iconClass}
      bgClass={config.bgClass}
      isUnread={isUnread}
    />
  )

  if (notification.post && notification.postId) {
    return (
      <Link
        to="/b/$slug/posts/$postId"
        params={{ slug: notification.post.boardSlug, postId: notification.postId }}
        onClick={handleClick}
      >
        {content}
      </Link>
    )
  }

  const isAdminContext = pathname.startsWith('/admin')
  const fallbackTo = isAdminContext ? '/admin/notifications' : '/notifications'

  if (isFullVariant) {
    return (
      <div onClick={handleClick} className="cursor-pointer">
        {content}
      </div>
    )
  }

  return (
    <Link to={fallbackTo} onClick={handleClick}>
      {content}
    </Link>
  )
}

interface ContentProps {
  notification: SerializedNotification
  icon: React.ComponentType<{ className?: string }>
  iconClass: string
  bgClass: string
  isUnread: boolean
}

function CompactContent({ notification, icon: Icon, iconClass, bgClass, isUnread }: ContentProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/50',
        isUnread && 'bg-primary/[0.02]'
      )}
    >
      <div
        className={cn(
          'flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center',
          bgClass
        )}
      >
        <Icon className={cn('h-4 w-4', iconClass)} />
      </div>

      <div className="flex-1 min-w-0 space-y-0.5">
        <p className={cn('text-sm leading-tight', isUnread ? 'font-medium' : 'text-foreground')}>
          {notification.title}
        </p>
        {notification.body && (
          <p className="text-xs text-muted-foreground line-clamp-2">{notification.body}</p>
        )}
        <p className="text-xs text-muted-foreground/70">
          {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
        </p>
      </div>

      {isUnread && <div className="flex-shrink-0 w-2 h-2 rounded-full bg-primary mt-1.5" />}
    </div>
  )
}

function FullContent({ notification, icon: Icon, iconClass, bgClass, isUnread }: ContentProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-4 px-5 py-4 transition-colors hover:bg-muted/30',
        isUnread && 'bg-primary/[0.02]'
      )}
    >
      <div
        className={cn(
          'flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center',
          bgClass
        )}
      >
        <Icon className={cn('h-5 w-5', iconClass)} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className={cn('text-sm leading-tight', isUnread && 'font-medium')}>
              {notification.title}
            </p>
            {notification.body && (
              <p className="text-sm text-muted-foreground line-clamp-2">{notification.body}</p>
            )}
            {notification.post && (
              <p className="text-xs text-muted-foreground/70">Post: {notification.post.title}</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {isUnread && <div className="w-2 h-2 rounded-full bg-primary" />}
            <span className="text-xs text-muted-foreground/70 whitespace-nowrap">
              {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
