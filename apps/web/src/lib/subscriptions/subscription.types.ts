/**
 * Subscription domain types
 *
 * These types are safe to import from client-side code as they have
 * no database dependencies.
 */

import type { MemberId, PostId, PostSubscriptionId } from '@quackback/ids'

export type SubscriptionReason = 'author' | 'vote' | 'comment' | 'manual'

export interface Subscriber {
  memberId: MemberId
  userId: string
  email: string
  name: string | null
  reason: SubscriptionReason
}

export interface Subscription {
  id: PostSubscriptionId
  postId: PostId
  postTitle: string
  reason: SubscriptionReason
  muted: boolean
  createdAt: Date
}

export interface NotificationPreferencesData {
  emailStatusChange: boolean
  emailNewComment: boolean
  emailMuted: boolean
}
