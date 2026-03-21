/**
 * Subscription domain types
 *
 * These types are safe to import from client-side code as they have
 * no database dependencies.
 */

import type { PrincipalId, PostId, PostSubscriptionId } from '@quackback/ids'

export type SubscriptionReason = 'author' | 'vote' | 'comment' | 'manual' | 'feedback_author'

export interface Subscriber {
  principalId: PrincipalId
  userId: string
  email: string
  name: string | null
  reason: SubscriptionReason
  notifyComments: boolean
  notifyStatusChanges: boolean
}

export interface Subscription {
  id: PostSubscriptionId
  postId: PostId
  postTitle: string
  reason: SubscriptionReason
  notifyComments: boolean
  notifyStatusChanges: boolean
  createdAt: Date
}

/**
 * Subscription level for UI display
 * - 'all': notifyComments=true, notifyStatusChanges=true
 * - 'status_only': notifyComments=false, notifyStatusChanges=true
 * - 'none': not subscribed (no row exists)
 */
export type SubscriptionLevel = 'all' | 'status_only' | 'none'

/** Derive a SubscriptionLevel from the two boolean notification columns */
export function levelFromFlags(
  notifyComments: boolean,
  notifyStatusChanges: boolean
): SubscriptionLevel {
  if (notifyComments && notifyStatusChanges) return 'all'
  if (notifyStatusChanges) return 'status_only'
  return 'none'
}

export interface NotificationPreferencesData {
  emailStatusChange: boolean
  emailNewComment: boolean
  emailMuted: boolean
}
