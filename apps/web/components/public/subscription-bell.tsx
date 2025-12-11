'use client'

import { useState, useCallback, useEffect } from 'react'
import { Bell, BellOff, BellRing, Check, Loader2 } from 'lucide-react'
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

  const handleSubscribe = useCallback(async () => {
    if (disabled && onAuthRequired) {
      onAuthRequired()
      setOpen(false)
      return
    }

    setLoading(true)
    try {
      const response = await fetch(`/api/posts/${postId}/subscription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'manual' }),
      })

      if (response.ok) {
        const data = await response.json()
        setStatus(data)
      }
    } catch (error) {
      console.error('Failed to subscribe:', error)
    } finally {
      setLoading(false)
      setOpen(false)
    }
  }, [postId, disabled, onAuthRequired])

  const handleUnsubscribe = useCallback(async () => {
    if (disabled && onAuthRequired) {
      onAuthRequired()
      setOpen(false)
      return
    }

    setLoading(true)
    try {
      const response = await fetch(`/api/posts/${postId}/subscription`, {
        method: 'DELETE',
      })

      if (response.ok) {
        const data = await response.json()
        setStatus(data)
      }
    } catch (error) {
      console.error('Failed to unsubscribe:', error)
    } finally {
      setLoading(false)
      setOpen(false)
    }
  }, [postId, disabled, onAuthRequired])

  const handleMute = useCallback(
    async (muted: boolean) => {
      if (disabled && onAuthRequired) {
        onAuthRequired()
        setOpen(false)
        return
      }

      setLoading(true)
      try {
        const response = await fetch(`/api/posts/${postId}/subscription`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ muted }),
        })

        if (response.ok) {
          const data = await response.json()
          setStatus(data)
        }
      } catch (error) {
        console.error('Failed to update subscription:', error)
      } finally {
        setLoading(false)
        setOpen(false)
      }
    },
    [postId, disabled, onAuthRequired]
  )

  // Determine current subscription level
  const getLevel = (): SubscriptionLevel => {
    if (!status.subscribed) return 'none'
    if (status.muted) return 'status_only'
    return 'all'
  }

  const level = getLevel()

  // Get appropriate icon
  const BellIcon = level === 'none' ? Bell : level === 'status_only' ? BellOff : BellRing

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
          className={cn(
            'flex items-center justify-center rounded-md p-2 transition-colors',
            level === 'none'
              ? 'text-muted-foreground hover:bg-muted hover:text-foreground'
              : 'text-primary bg-primary/10 hover:bg-primary/20',
            loading && 'opacity-50 cursor-wait'
          )}
          title={
            level === 'none'
              ? 'Get notified about updates'
              : level === 'status_only'
                ? 'Notifications muted (status only)'
                : 'Receiving all notifications'
          }
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
          <p className="text-xs text-muted-foreground">Get updates on this post</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* All notifications */}
        <DropdownMenuItem
          onClick={() => (status.subscribed && !status.muted ? null : handleSubscribe())}
          className="flex items-center justify-between"
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

        {/* Status only (muted comments) */}
        <DropdownMenuItem
          onClick={() => {
            if (!status.subscribed) {
              // Subscribe first, then mute
              handleSubscribe().then(() => handleMute(true))
            } else if (!status.muted) {
              handleMute(true)
            }
          }}
          className="flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <BellOff className="h-4 w-4" />
            <div>
              <p className="text-sm">Status only</p>
              <p className="text-xs text-muted-foreground">No comment notifications</p>
            </div>
          </div>
          {level === 'status_only' && <Check className="h-4 w-4 text-primary" />}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Unsubscribe */}
        <DropdownMenuItem
          onClick={() => (status.subscribed ? handleUnsubscribe() : null)}
          disabled={!status.subscribed}
          className="flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            <div>
              <p className="text-sm">Off</p>
              <p className="text-xs text-muted-foreground">No notifications</p>
            </div>
          </div>
          {level === 'none' && <Check className="h-4 w-4 text-primary" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
