'use client'

import { Link } from '@tanstack/react-router'
import { FormattedMessage, useIntl } from 'react-intl'
import { ArchiveBoxIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/shared/utils'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { useLocalDateFormatter } from '@/components/ui/local-date'
import { TimeAgo } from '@/components/ui/time-ago'
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
  const rowClassName = cn(isFullVariant && 'group block', className)

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
        <Avatar
          className="h-9 w-9"
          src={notification.actorAvatarUrl}
          name={notification.actorName}
          fallbackClassName="text-xs"
        />
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

const STAMP: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
}
const EARLIER: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
}
const CALENDAR_DAY: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
}

/**
 * A notification's time, with the full stamp ("Oct 1, 2026, 3:04 PM") in its
 * title: relative ("5 minutes ago") always, or only for today with "Oct 1,
 * 3:04 PM" before that, all in the app's language. Today and the stamp follow
 * the viewer's zone once hydrated; as a leaf, that switch re-renders only
 * this text.
 */
function NotificationTime({
  createdAt,
  relative,
  className,
}: {
  createdAt: string
  relative: 'always' | 'today'
  className: string
}) {
  const format = useLocalDateFormatter()
  const isToday = format(createdAt, CALENDAR_DAY) === format(new Date(), CALENDAR_DAY)
  return (
    <time
      className={className}
      dateTime={new Date(createdAt).toISOString()}
      title={format(createdAt, STAMP)}
    >
      {relative === 'always' || isToday ? <TimeAgo date={createdAt} /> : format(createdAt, EARLIER)}
    </time>
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
        {/* The dot below is aria-hidden, so this label is the only unread
            signal exposed to screen readers. */}
        {isUnread && (
          <span className="sr-only">
            <FormattedMessage id="portal.notifications.item.unread" defaultMessage="Unread" />
          </span>
        )}
        <p className={cn('text-sm leading-tight', isUnread ? 'font-medium' : 'text-foreground')}>
          {notification.title}
        </p>
        {notification.body && (
          <p className="text-xs text-muted-foreground line-clamp-2">{notification.body}</p>
        )}
        <NotificationTime
          createdAt={notification.createdAt}
          relative="always"
          className="block text-xs text-muted-foreground/70"
        />
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
  const intl = useIntl()
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
        'relative flex min-h-14 items-center gap-3 py-2.5 transition-colors hover:bg-muted/30',
        isUnread && 'bg-primary/[0.02]'
      )}
    >
      <NotificationLeadingVisual
        notification={notification}
        icon={Icon}
        iconClass={iconClass}
        bgClass={bgClass}
        variant="full"
      />

      {/* The time sits on the row's right edge and fades while the archive
          button, which takes its place, is showing. */}
      <div className="min-w-0 flex-1">
        {/* The dot is aria-hidden, so this label is the only unread signal
            exposed to screen readers. */}
        {isUnread && (
          <span className="sr-only">
            <FormattedMessage id="portal.notifications.item.unread" defaultMessage="Unread" />
          </span>
        )}
        <div className="flex items-baseline justify-between gap-3">
          <p
            className={cn(
              'min-w-0 truncate text-sm leading-tight',
              isUnread ? 'font-medium' : 'text-foreground'
            )}
          >
            {notification.title}
          </p>
          <span className="flex shrink-0 items-center gap-2 transition-opacity group-focus-within:opacity-0 group-hover:opacity-0">
            {isUnread && (
              <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            )}
            <NotificationTime
              createdAt={notification.createdAt}
              relative="today"
              className="text-xs whitespace-nowrap text-muted-foreground"
            />
          </span>
        </div>
        {(notification.body || notification.post) && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {notification.body}
            {notification.body && notification.post && (
              <span className="text-muted-foreground/40"> · </span>
            )}
            {notification.post && (
              <span className="text-muted-foreground/70">{notification.post.title}</span>
            )}
          </p>
        )}
      </div>

      {onArchive && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleArchiveClick}
          aria-label={intl.formatMessage({
            id: 'portal.notifications.item.archive',
            defaultMessage: 'Archive notification',
          })}
          className={cn(
            'absolute end-0 top-1/2 h-7 w-7 -translate-y-1/2',
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
