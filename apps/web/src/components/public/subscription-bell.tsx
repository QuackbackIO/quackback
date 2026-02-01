import { useState, useCallback, useEffect } from 'react'
import { BellIcon, BellAlertIcon, CheckIcon, ArrowPathIcon } from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  fetchSubscriptionStatus,
  subscribeToPostFn,
  unsubscribeFromPostFn,
  updateSubscriptionLevelFn,
} from '@/lib/server/functions/subscriptions'
import type { PostId } from '@quackback/ids'
import type { SubscriptionLevel } from '@/lib/server/domains/subscriptions/subscription.types'

interface SubscriptionStatus {
  subscribed: boolean
  level: SubscriptionLevel
  reason: string | null
}

interface SubscriptionBellProps {
  postId: PostId
  initialStatus?: SubscriptionStatus
  disabled?: boolean
  onAuthRequired?: () => void
}

export function SubscriptionBell({
  postId,
  initialStatus,
  disabled = false,
  onAuthRequired,
}: SubscriptionBellProps) {
  const [status, setStatus] = useState<SubscriptionStatus>(
    initialStatus || { subscribed: false, level: 'none', reason: null }
  )
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  // Always fetch fresh status on mount to handle out-of-band changes (email unsubscribe, etc.)
  useEffect(() => {
    if (!disabled) {
      fetchStatus()
    }
  }, [postId, disabled])

  const fetchStatus = async () => {
    try {
      const result = await fetchSubscriptionStatus({ data: { postId } })
      setStatus({
        subscribed: result.subscribed,
        level: result.level,
        reason: result.reason,
      })
    } catch (error) {
      console.error('Failed to fetch subscription status:', error)
    }
  }

  const updateSubscription = useCallback(
    async (newLevel: SubscriptionLevel) => {
      if (disabled && onAuthRequired) {
        onAuthRequired()
        setOpen(false)
        return
      }

      // Optimistic update - update UI immediately
      const previousStatus = { ...status }
      setStatus({
        subscribed: newLevel !== 'none',
        level: newLevel,
        reason: newLevel !== 'none' ? 'manual' : null,
      })
      setOpen(false)

      setLoading(true)
      try {
        if (newLevel === 'none') {
          // Unsubscribe - delete the subscription
          await unsubscribeFromPostFn({ data: { postId } })
        } else if (!previousStatus.subscribed) {
          // Not subscribed yet - create subscription with level
          await subscribeToPostFn({ data: { postId, reason: 'manual', level: newLevel } })
        } else {
          // Already subscribed - just update the level
          await updateSubscriptionLevelFn({ data: { postId, level: newLevel } })
        }

        // Sync with server truth
        await fetchStatus()
      } catch (error) {
        // Revert on error
        console.error('Failed to update subscription:', error)
        setStatus(previousStatus)
      } finally {
        setLoading(false)
      }
    },
    [postId, disabled, onAuthRequired, status]
  )

  const level = status.level

  // Icon: Bell when not subscribed, BellAlert when subscribed (any level)
  const isSubscribed = status.subscribed
  const BellIconComponent = isSubscribed ? BellAlertIcon : BellIcon

  function getAriaLabel(): string {
    if (!isSubscribed) return 'Subscribe to notifications'
    if (level === 'status_only') return 'Subscribed to status changes only'
    return 'Subscribed to all activity'
  }

  // Button click handler for non-dropdown scenarios
  function handleButtonClick(): void {
    if (disabled && onAuthRequired) {
      onAuthRequired()
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          onClick={handleButtonClick}
          disabled={loading}
          aria-label={getAriaLabel()}
          className={cn(
            'flex items-center justify-center [border-radius:calc(var(--radius)*0.8)] p-2 transition-colors',
            !isSubscribed
              ? 'text-muted-foreground hover:bg-muted hover:text-foreground'
              : 'text-primary bg-primary/10 hover:bg-primary/20',
            loading && 'opacity-50 cursor-wait'
          )}
        >
          {loading ? (
            <ArrowPathIcon className="h-5 w-5 animate-spin" />
          ) : (
            <BellIconComponent className="h-5 w-5" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <p className="text-sm font-medium">Notifications</p>
          <p className="text-xs text-muted-foreground">Choose what to subscribe to</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* All activity */}
        <DropdownMenuItem
          onClick={() => level !== 'all' && updateSubscription('all')}
          className="flex items-center justify-between cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <BellAlertIcon className="h-4 w-4" />
            <div>
              <p className="text-sm">All activity</p>
              <p className="text-xs text-muted-foreground">Comments & status changes</p>
            </div>
          </div>
          {level === 'all' && <CheckIcon className="h-4 w-4 text-primary" />}
        </DropdownMenuItem>

        {/* Status changes only */}
        <DropdownMenuItem
          onClick={() => level !== 'status_only' && updateSubscription('status_only')}
          className="flex items-center justify-between cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <BellIcon className="h-4 w-4" />
            <div>
              <p className="text-sm">Status changes</p>
              <p className="text-xs text-muted-foreground">When status is updated</p>
            </div>
          </div>
          {level === 'status_only' && <CheckIcon className="h-4 w-4 text-primary" />}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Unsubscribe */}
        <DropdownMenuItem
          onClick={() => level !== 'none' && updateSubscription('none')}
          disabled={!status.subscribed}
          className="flex items-center justify-between cursor-pointer"
        >
          <div className="flex items-center gap-2 text-muted-foreground">
            <BellIcon className="h-4 w-4" />
            <p className="text-sm">Unsubscribe</p>
          </div>
          {level === 'none' && <CheckIcon className="h-4 w-4 text-primary" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
