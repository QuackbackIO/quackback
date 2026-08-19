'use client'

import { Link } from '@tanstack/react-router'
import { formatDistanceToNow, isToday, format } from 'date-fns'
import { ArchiveBoxIcon } from '@heroicons/react/24/outline'
import { cn, getInitials } from '@/lib/shared/utils'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { getNotificationTypeConfig } from './notification-type-config'
import { getNotificationTarget } from './notification-target'
import type { SerializedNotification } from '@/lib/client/hooks/use-notifications-queries'

interface NotificationItemProps {
  notification: SerializedNotification
  onMarkAsRead?: (id: SerializedNotification['id']) => void
  /** Archives the row. Only rendered as a button in the 'full' variant. */
  onArchive?: (id: SerializedNotification['id']) => void
  onClick?: () => void
  /** Layout variant: 'compact' for dropdown, 'full' for page view */
  variant?: 'compact' | 'full'
  /** Extra classes for the row root, e.g. staggered fade-in animation classes */
  className?: string
  /** Extra inline styles for the row root, e.g. per-row animation delay */
  style?: React.CSSProperties
}

// Same ring treatment as the bell button that opens the notification
// dropdown, so every focusable notification surface reads consistently.
const FOCUS_RING_CLASS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function NotificationItem({
  notification,
  onMarkAsRead,
  onArchive,
  onClick,
  variant = 'compact',
  className,
  style,
}: NotificationItemProps) {
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

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Enter' || event.key === ' ') {
      // Space would otherwise scroll the page since the row isn't a
      // native button.
      if (event.key === ' ') {
        event.preventDefault()
      }
      handleClick()
    }
  }

  const content = isFullVariant ? (
    <FullContent
      notification={notification}
      icon={Icon}
      iconClass={config.iconClass}
      bgClass={config.bgClass}
      isUnread={isUnread}
      onArchive={onArchive}
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

  // `group` scopes the archive button's hover/focus visibility to this row;
  // only applied for the full variant, which is the only one that ever
  // renders the button.
  const rowClassName = cn(isFullVariant && 'group', className)

  const target = getNotificationTarget(notification)

  if (target) {
    return (
      <Link
        to={target.to}
        params={target.params}
        search={target.search}
        hash={target.hash}
        onClick={handleClick}
        className={cn(rowClassName, FOCUS_RING_CLASS)}
        style={style}
      >
        {content}
      </Link>
    )
  }

  // Unroutable row: only unread rows are interactive (clicking marks them
  // read). A read, unroutable row has nothing to do on click, so it's
  // rendered inert — no role/tabIndex/onClick — rather than a dead focus
  // stop or click target.
  if (isUnread) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={cn(rowClassName, FOCUS_RING_CLASS)}
        style={style}
      >
        {content}
      </div>
    )
  }

  return (
    <div className={rowClassName} style={style}>
      {content}
    </div>
  )
}

interface ContentProps {
  notification: SerializedNotification
  icon: React.ComponentType<{ className?: string }>
  iconClass: string
  bgClass: string
  isUnread: boolean
  /** Full-variant only; ignored by CompactContent. */
  onArchive?: (id: SerializedNotification['id']) => void
}

/**
 * Leading visual for a notification row. Person-driven notifications (a
 * comment, mention, or visitor message) show the actor's avatar with the
 * type icon as a small overlay badge; system-driven types (status changes,
 * assignments, changelogs) and any row created before actorName existed keep
 * the plain icon circle. Shared by both variants so the two layouts never
 * drift from each other. Fixed at 36px wide so the compact dropdown remains
 * bounded.
 */
function NotificationLeadingVisual({
  notification,
  icon: Icon,
  iconClass,
  bgClass,
  variant,
}: {
  notification: SerializedNotification
  icon: React.ComponentType<{ className?: string }>
  iconClass: string
  bgClass: string
  variant: 'compact' | 'full'
}) {
  if (notification.actorName) {
    return (
      <div className="relative flex-shrink-0">
        <Avatar className="h-9 w-9">
          {notification.actorAvatarUrl && (
            <AvatarImage src={notification.actorAvatarUrl} alt={notification.actorName} />
          )}
          <AvatarFallback className="text-xs">{getInitials(notification.actorName)}</AvatarFallback>
        </Avatar>
        <span
          className={cn(
            'absolute -bottom-0.5 -end-0.5 w-[17px] h-[17px] rounded-full border-2 border-card flex items-center justify-center',
            bgClass
          )}
        >
          <Icon className={cn('h-2.5 w-2.5', iconClass)} />
        </span>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex-shrink-0 w-9 h-9 flex items-center justify-center',
        variant === 'full' ? 'rounded-lg' : 'rounded-full',
        bgClass
      )}
    >
      <Icon className={cn(variant === 'full' ? 'h-4.5 w-4.5' : 'h-4 w-4', iconClass)} />
    </div>
  )
}

function CompactContent({ notification, icon: Icon, iconClass, bgClass, isUnread }: ContentProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-muted/50',
        isUnread && 'bg-primary/[0.02]'
      )}
    >
      <NotificationLeadingVisual
        notification={notification}
        icon={Icon}
        iconClass={iconClass}
        bgClass={bgClass}
        variant="compact"
      />

      <div className="flex-1 min-w-0 space-y-0.5">
        {/* The dot below is aria-hidden, so this plain-English label is the
            only unread signal exposed to screen readers. Both surfaces share
            this component, so full i18n of the row is out of scope here. */}
        {isUnread && <span className="sr-only">Unread</span>}
        <p className={cn('text-sm leading-tight', isUnread ? 'font-medium' : 'text-foreground')}>
          {notification.title}
        </p>
        {notification.body && (
          <p className="text-xs text-muted-foreground line-clamp-2">{notification.body}</p>
        )}
        <time
          className="block text-xs text-muted-foreground/70"
          dateTime={new Date(notification.createdAt).toISOString()}
          title={format(new Date(notification.createdAt), 'MMM d, yyyy, h:mm a')}
        >
          {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
        </time>
      </div>

      {isUnread && (
        <div className="flex-shrink-0 w-2 h-2 rounded-full bg-primary mt-1.5" aria-hidden="true" />
      )}
    </div>
  )
}

function FullContent({
  notification,
  icon: Icon,
  iconClass,
  bgClass,
  isUnread,
  onArchive,
}: ContentProps) {
  const createdAt = new Date(notification.createdAt)

  function handleArchiveClick(event: React.MouseEvent<HTMLButtonElement>): void {
    // The row itself is (or is wrapped by) a Link — stop the click from
    // bubbling into it so archiving never triggers a navigation.
    event.preventDefault()
    event.stopPropagation()
    onArchive?.(notification.id)
  }

  return (
    <div
      className={cn(
        'relative flex items-start gap-4 px-5 py-4 transition-colors hover:bg-muted/30',
        isUnread && 'bg-primary/[0.02]'
      )}
    >
      {isUnread && (
        <div
          className="absolute start-0 top-3 bottom-3 w-0.5 rounded-full bg-primary"
          aria-hidden="true"
        />
      )}

      <NotificationLeadingVisual
        notification={notification}
        icon={Icon}
        iconClass={iconClass}
        bgClass={bgClass}
        variant="full"
      />

      {/* End padding reserves room for the absolutely-positioned unread dot
          and archive button so long titles never run underneath them. */}
      <div className="flex-1 min-w-0 pe-14">
        {/* The accent bar and dot are aria-hidden, so this plain-English
            label is the only unread signal exposed to screen readers. Both
            surfaces share this component, so full i18n of the row is out of
            scope here. */}
        {isUnread && <span className="sr-only">Unread</span>}
        <p className={cn('text-sm leading-tight', isUnread ? 'font-medium' : 'text-foreground')}>
          {notification.title}
        </p>
        {notification.body && (
          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{notification.body}</p>
        )}
        <div className="flex items-center gap-2 mt-1">
          {notification.post && (
            <>
              <span className="text-[11px] text-muted-foreground/60 truncate max-w-[200px]">
                {notification.post.title}
              </span>
              <span className="text-muted-foreground/40">·</span>
            </>
          )}
          <time
            className="text-[11px] text-muted-foreground/60 whitespace-nowrap"
            dateTime={createdAt.toISOString()}
            title={format(createdAt, 'MMM d, yyyy, h:mm a')}
          >
            {isToday(createdAt)
              ? formatDistanceToNow(createdAt, { addSuffix: true })
              : format(createdAt, 'MMM d, h:mm a')}
          </time>
        </div>
      </div>

      {/* Sits to the start-side of the archive button (below), clear of its
          hitbox so the two never overlap. */}
      {isUnread && (
        <div
          className="absolute end-10 top-4 flex-shrink-0 w-2.5 h-2.5 rounded-full bg-primary ring-4 ring-primary/10"
          aria-hidden="true"
        />
      )}

      {onArchive && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleArchiveClick}
          aria-label="Archive notification"
          className={cn(
            'absolute end-2 top-2 h-7 w-7',
            'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-within:opacity-100',
            'transition-opacity'
          )}
        >
          <ArchiveBoxIcon className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}
