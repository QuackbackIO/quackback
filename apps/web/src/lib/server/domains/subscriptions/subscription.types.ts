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

export interface NotificationPreferencesData {
  emailStatusChange: boolean
  emailNewComment: boolean
  emailMuted: boolean
}
