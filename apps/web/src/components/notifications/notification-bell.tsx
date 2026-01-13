'use client'

import { useState } from 'react'
import { BellIcon } from '@heroicons/react/24/outline'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useUnreadCount } from '@/lib/hooks/use-notifications-queries'
import { NotificationDropdown } from './notification-dropdown'
import { cn } from '@/lib/utils'

interface NotificationBellProps {
  className?: string
  /** Popover position: 'right' for sidebar, 'bottom' for header */
  popoverSide?: 'right' | 'bottom'
}

export function NotificationBell({ className, popoverSide = 'right' }: NotificationBellProps) {
  const [open, setOpen] = useState(false)
  const { data: unreadCount = 0 } = useUnreadCount()

  const isBottomAligned = popoverSide === 'bottom'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              className={cn(
                'relative flex items-center justify-center w-10 h-10 rounded-lg',
                'text-muted-foreground/70 hover:text-foreground hover:bg-muted/50',
                'transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                className
              )}
              aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
            >
              <BellIcon className="h-5 w-5" />
              {unreadCount > 0 && (
                <span
                  className={cn(
                    'absolute -top-0.5 -right-0.5 flex items-center justify-center',
                    'min-w-[18px] h-[18px] px-1 rounded-full',
                    'bg-primary text-primary-foreground text-[10px] font-semibold',
                    'border-2 border-card'
                  )}
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side={isBottomAligned ? 'bottom' : 'right'} sideOffset={8}>
          Notifications
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        align={isBottomAligned ? 'end' : 'start'}
        side={popoverSide}
        sideOffset={8}
        className="w-80 p-0"
      >
        <NotificationDropdown onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}
