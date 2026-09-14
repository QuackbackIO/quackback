'use client'

import { useState, useEffect, useRef } from 'react'
import { BellIcon } from '@heroicons/react/24/outline'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useUnreadCount } from '@/lib/client/hooks/use-notifications-queries'
import { NotificationDropdown } from './notification-dropdown'
import { cn } from '@/lib/shared/utils'

interface NotificationBellProps {
  className?: string
  /** Popover position: 'right' for sidebar, 'bottom' for header */
  popoverSide?: 'right' | 'bottom'
  /** Icon + visible label. Default stays icon-only with a tooltip. */
  labeled?: boolean
}

export function NotificationBell({
  className,
  popoverSide = 'right',
  labeled = false,
}: NotificationBellProps) {
  const [open, setOpen] = useState(false)
  const { data: unreadCount = 0 } = useUnreadCount()
  const [shouldPulse, setShouldPulse] = useState(false)
  const prevCountRef = useRef(unreadCount)

  // Pulse animation when unread count increases
  useEffect(() => {
    if (unreadCount > prevCountRef.current && unreadCount > 0) {
      setShouldPulse(true)
      const timer = setTimeout(() => setShouldPulse(false), 1000)
      return () => clearTimeout(timer)
    }
    prevCountRef.current = unreadCount
  }, [unreadCount])

  const isBottomAligned = popoverSide === 'bottom'

  const trigger = (
    <PopoverTrigger asChild>
      <button
        data-admin-rail-item={labeled ? '' : undefined}
        className={cn(
          'relative transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          labeled
            ? 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm'
            : 'flex h-10 w-10 items-center justify-center rounded-lg',
          'text-muted-foreground/70 hover:bg-muted/50 hover:text-foreground',
          className
        )}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <BellIcon className="h-5 w-5 shrink-0" />
        {labeled ? <span className="min-w-0 flex-1 truncate text-left">Notifications</span> : null}
        {unreadCount > 0 && (
          <span
            className={cn(
              labeled
                ? 'ms-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1'
                : 'absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1',
              'border-2 border-card bg-primary text-[11px] font-semibold text-primary-foreground',
              shouldPulse && 'animate-pulse'
            )}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
    </PopoverTrigger>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {labeled ? (
        trigger
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side={isBottomAligned ? 'bottom' : 'right'} sideOffset={8}>
            Notifications
          </TooltipContent>
        </Tooltip>
      )}
      <PopoverContent
        align={isBottomAligned ? 'end' : 'start'}
        side={popoverSide}
        sideOffset={8}
        className="w-76 p-0"
      >
        <NotificationDropdown onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}
