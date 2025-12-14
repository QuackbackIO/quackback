'use client'

import { useState, useCallback, useEffect } from 'react'
import { Bell, BellRing, Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type SubscriptionLevel = 'all' | 'status_only' | 'none'

interface SubscriptionStatus {
  subscribed: boolean
  muted: boolean
  reason: string | null
}

interface SubscriptionBellProps {
  postId: string
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
    initialStatus || { subscribed: false, muted: false, reason: null }
  )
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  // Fetch status on mount if not provided
  useEffect(() => {
    if (!initialStatus && !disabled) {
      fetchStatus()
    }
  }, [postId, disabled, initialStatus])

  const fetchStatus = async () => {
    try {
      const response = await fetch(`/api/posts/${postId}/subscription`)
      if (response.ok) {
        const data = await response.json()
        setStatus(data)
      }
    } catch (error) {
      console.error('Failed to fetch subscription status:', error)
    }
  }

  const updateSubscription = useCallback(
    async (level: SubscriptionLevel) => {
      if (disabled && onAuthRequired) {
        onAuthRequired()
        setOpen(false)
        return
      }

      setLoading(true)
      try {
        let response: Response

        if (level === 'none') {
          // Unsubscribe
          response = await fetch(`/api/posts/${postId}/subscription`, {
            method: 'DELETE',
          })
        } else if (level === 'all') {
          // Subscribe to all (unmuted)
          if (!status.subscribed) {
            response = await fetch(`/api/posts/${postId}/subscription`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reason: 'manual' }),
            })
          } else {
            // Already subscribed, just unmute
            response = await fetch(`/api/posts/${postId}/subscription`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ muted: false }),
            })
          }
        } else {
          // Subscribe to status only (muted)
          if (!status.subscribed) {
            // Subscribe first
            await fetch(`/api/posts/${postId}/subscription`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reason: 'manual' }),
            })
          }
          // Then mute
          response = await fetch(`/api/posts/${postId}/subscription`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ muted: true }),
          })
        }

        if (response!.ok) {
          const data = await response!.json()
          setStatus(data)
        }
      } catch (error) {
        console.error('Failed to update subscription:', error)
      } finally {
        setLoading(false)
        setOpen(false)
      }
    },
    [postId, disabled, onAuthRequired, status.subscribed]
  )

  // Determine current subscription level
  const getLevel = (): SubscriptionLevel => {
    if (!status.subscribed) return 'none'
    if (status.muted) return 'status_only'
    return 'all'
  }

  const level = getLevel()

  // Icon: Bell when not subscribed, BellRing when subscribed (any level)
  const isSubscribed = status.subscribed
  const BellIcon = isSubscribed ? BellRing : Bell

  // Button click handler for non-dropdown scenarios
  const handleButtonClick = () => {
    if (disabled && onAuthRequired) {
      onAuthRequired()
      return
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          onClick={handleButtonClick}
          disabled={loading}
          aria-label={
            !isSubscribed
              ? 'Subscribe to notifications'
              : level === 'status_only'
                ? 'Subscribed to status changes only'
                : 'Subscribed to all activity'
          }
          className={cn(
            'flex items-center justify-center [border-radius:calc(var(--radius)*0.8)] p-2 transition-colors',
            !isSubscribed
              ? 'text-muted-foreground hover:bg-muted hover:text-foreground'
              : 'text-primary bg-primary/10 hover:bg-primary/20',
            loading && 'opacity-50 cursor-wait'
          )}
        >
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <BellIcon className="h-5 w-5" />
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
            <BellRing className="h-4 w-4" />
            <div>
              <p className="text-sm">All activity</p>
              <p className="text-xs text-muted-foreground">Comments & status changes</p>
            </div>
          </div>
          {level === 'all' && <Check className="h-4 w-4 text-primary" />}
        </DropdownMenuItem>

        {/* Status changes only */}
        <DropdownMenuItem
          onClick={() => level !== 'status_only' && updateSubscription('status_only')}
          className="flex items-center justify-between cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            <div>
              <p className="text-sm">Status changes</p>
              <p className="text-xs text-muted-foreground">When status is updated</p>
            </div>
          </div>
          {level === 'status_only' && <Check className="h-4 w-4 text-primary" />}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Unsubscribe */}
        <DropdownMenuItem
          onClick={() => level !== 'none' && updateSubscription('none')}
          disabled={!status.subscribed}
          className="flex items-center justify-between cursor-pointer"
        >
          <div className="flex items-center gap-2 text-muted-foreground">
            <Bell className="h-4 w-4" />
            <p className="text-sm">Unsubscribe</p>
          </div>
          {level === 'none' && <Check className="h-4 w-4 text-primary" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
