/**
 * Centralized type exports for the lib layer.
 *
 * Import types from here to avoid circular dependencies:
 *   import type { InboxFilters, PostDetails } from '@/lib/shared/types'
 */

// Filter types
export type {
  InboxFilters,
  PublicFeedbackFilters,
  RoadmapFilters,
  SuggestionsFilters,
  UsersFilters,
} from './filters'

// Inbox/post detail types
export type {
  PinnedComment,
  CommentReaction,
  CommentWithReplies,
  PostDetails,
  CurrentUser,
  MergedPostItem,
} from './inbox'

// Post domain types
export type { CreatePostInput, AdminEditPostInput, PublicPostListItem } from './posts'

// User domain types
export type {
  UserSegmentSummary,
  PortalUserListParams,
  PortalUserListItemView,
  PortalUserListResultView,
  PortalUserDetail,
  EngagedPost,
} from './users'

// Subscription types
export type { SubscriptionLevel } from './subscriptions'

// Principal types
export type { TeamMember } from './principals'

// Board types
export type { BoardWithStats, PublicBoardWithStats } from './boards'

// Roadmap types
export type {
  RoadmapPost,
  RoadmapPostListResult,
  RoadmapPostsListResult,
  RoadmapPostEntry,
} from './roadmaps'

// Webhook types
export type { Webhook } from './webhooks'

// API key types
export type { ApiKey } from './api-keys'

// Settings types
export type { FeatureFlags } from './settings'
export { FEATURE_FLAG_REGISTRY, LAB_SECTIONS } from './settings'

// Import types
export type { ImportResult } from './import'

// Activity types
export type { ActivityType } from './activity'

// Notification types
export type { NotificationType } from './notifications'
