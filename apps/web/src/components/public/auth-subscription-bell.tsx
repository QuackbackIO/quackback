import { SubscriptionBell } from './subscription-bell'
import { useAuthPopover } from '@/components/auth/auth-popover-context'
import type { PostId } from '@quackback/ids'
import type { SubscriptionLevel } from '@/lib/server/domains/subscriptions/subscription.types'

interface SubscriptionStatus {
  subscribed: boolean
  level: SubscriptionLevel
  reason: string | null
}

interface AuthSubscriptionBellProps {
  postId: PostId
  initialStatus?: SubscriptionStatus
  /** Whether subscription is disabled (user not authenticated) */
  disabled?: boolean
}

/**
 * SubscriptionBell wrapper that shows auth dialog when unauthenticated user tries to subscribe.
 */
export function AuthSubscriptionBell({
  postId,
  initialStatus,
  disabled = false,
}: AuthSubscriptionBellProps) {
  const { openAuthPopover } = useAuthPopover()

  const handleAuthRequired = () => {
    openAuthPopover({ mode: 'login' })
  }

  return (
    <SubscriptionBell
      postId={postId}
      initialStatus={initialStatus}
      disabled={disabled}
      onAuthRequired={disabled ? handleAuthRequired : undefined}
    />
  )
}
