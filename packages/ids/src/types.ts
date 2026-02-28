/**
 * TypeID type definitions
 *
 * Uses template literal types for compile-time prefix validation
 * while maintaining runtime string compatibility.
 */

import type { IdPrefix } from './prefixes'

/**
 * TypeID string type with embedded prefix
 *
 * Format: {prefix}_{base32_suffix}
 * The base32 suffix is always 26 characters (UUIDv7 encoded)
 *
 * @example
 * type PostTypeId = TypeId<'post'> // 'post_${string}'
 */
export type TypeId<P extends IdPrefix> = `${P}_${string}`

// ============================================
// Application Entity IDs
// ============================================

/** Feedback post ID - e.g., post_01h455vb4pex5vsknk084sn02q */
export type PostId = TypeId<'post'>

/** Board ID - e.g., board_01h455vb4pex5vsknk084sn02q */
export type BoardId = TypeId<'board'>

/** Comment ID - e.g., comment_01h455vb4pex5vsknk084sn02q */
export type CommentId = TypeId<'comment'>

/** Vote ID - e.g., vote_01h455vb4pex5vsknk084sn02q */
export type VoteId = TypeId<'vote'>

/** Tag ID - e.g., tag_01h455vb4pex5vsknk084sn02q */
export type TagId = TypeId<'tag'>

/** Post status ID - e.g., status_01h455vb4pex5vsknk084sn02q */
export type StatusId = TypeId<'status'>

/** Comment reaction ID - e.g., reaction_01h455vb4pex5vsknk084sn02q */
export type ReactionId = TypeId<'reaction'>

/** Roadmap ID - e.g., roadmap_01h455vb4pex5vsknk084sn02q */
export type RoadmapId = TypeId<'roadmap'>

/** Changelog entry ID - e.g., changelog_01h455vb4pex5vsknk084sn02q */
export type ChangelogId = TypeId<'changelog'>

/** Integration ID - e.g., integration_01h455vb4pex5vsknk084sn02q */
export type IntegrationId = TypeId<'integration'>

/** Platform credential ID - e.g., platform_cred_01h455vb4pex5vsknk084sn02q */
export type PlatformCredentialId = TypeId<'platform_cred'>

/** Event mapping ID - e.g., event_mapping_01h455vb4pex5vsknk084sn02q */
export type EventMappingId = TypeId<'event_mapping'>

/** Linked entity ID - e.g., linked_entity_01h455vb4pex5vsknk084sn02q */
export type LinkedEntityId = TypeId<'linked_entity'>

/** Sync log ID - e.g., sync_log_01h455vb4pex5vsknk084sn02q */
export type SyncLogId = TypeId<'sync_log'>

/** Post subscription ID - e.g., post_sub_01h455vb4pex5vsknk084sn02q */
export type PostSubscriptionId = TypeId<'post_sub'>

/** Notification preference ID - e.g., notif_pref_01h455vb4pex5vsknk084sn02q */
export type NotifPrefId = TypeId<'notif_pref'>

/** Unsubscribe token ID - e.g., unsub_token_01h455vb4pex5vsknk084sn02q */
export type UnsubTokenId = TypeId<'unsub_token'>

/** In-app notification ID - e.g., notification_01h455vb4pex5vsknk084sn02q */
export type NotificationId = TypeId<'notification'>

/** Post edit history ID - e.g., post_edit_01h455vb4pex5vsknk084sn02q */
export type PostEditId = TypeId<'post_edit'>

/** Comment edit history ID - e.g., comment_edit_01h455vb4pex5vsknk084sn02q */
export type CommentEditId = TypeId<'comment_edit'>

/** Internal staff note ID - e.g., note_01h455vb4pex5vsknk084sn02q */
export type NoteId = TypeId<'note'>

/** Segment ID - e.g., segment_01h455vb4pex5vsknk084sn02q */
export type SegmentId = TypeId<'segment'>

/** User attribute definition ID - e.g., user_attr_01h455vb4pex5vsknk084sn02q */
export type UserAttributeId = TypeId<'user_attr'>

// ============================================
// AI Entity IDs
// ============================================

/** Post sentiment analysis ID - e.g., sentiment_01h455vb4pex5vsknk084sn02q */
export type SentimentId = TypeId<'sentiment'>

// ============================================
// Feedback Aggregation Entity IDs
// ============================================

/** Feedback source ID - e.g., feedback_source_01h455vb4pex5vsknk084sn02q */
export type FeedbackSourceId = TypeId<'feedback_source'>

/** Raw feedback item ID - e.g., raw_feedback_01h455vb4pex5vsknk084sn02q */
export type RawFeedbackItemId = TypeId<'raw_feedback'>

/** Feedback signal ID - e.g., feedback_signal_01h455vb4pex5vsknk084sn02q */
export type FeedbackSignalId = TypeId<'feedback_signal'>

/** Feedback suggestion ID - e.g., feedback_suggestion_01h455vb4pex5vsknk084sn02q */
export type FeedbackSuggestionId = TypeId<'feedback_suggestion'>

/** Feedback signal correction ID - e.g., signal_correction_01h455vb4pex5vsknk084sn02q */
export type FeedbackCorrectionId = TypeId<'signal_correction'>

/** External user mapping ID - e.g., user_mapping_01h455vb4pex5vsknk084sn02q */
export type ExternalUserMappingId = TypeId<'user_mapping'>

// ============================================
// Auth Entity IDs (Better-auth)
// ============================================

/** Workspace ID - e.g., workspace_01h455vb4pex5vsknk084sn02q */
export type WorkspaceId = TypeId<'workspace'>

/** User ID - e.g., user_01h455vb4pex5vsknk084sn02q */
export type UserId = TypeId<'user'>

/** Principal ID - e.g., principal_01h455vb4pex5vsknk084sn02q */
export type PrincipalId = TypeId<'principal'>

/** Session ID - e.g., session_01h455vb4pex5vsknk084sn02q */
export type SessionId = TypeId<'session'>

/** Account ID - e.g., account_01h455vb4pex5vsknk084sn02q */
export type AccountId = TypeId<'account'>

/** Invitation ID - e.g., invite_01h455vb4pex5vsknk084sn02q */
export type InviteId = TypeId<'invite'>

/** Verification ID - e.g., verification_01h455vb4pex5vsknk084sn02q */
export type VerificationId = TypeId<'verification'>

/** Domain ID - e.g., domain_01h455vb4pex5vsknk084sn02q */
export type DomainId = TypeId<'domain'>

/** Transfer token ID - e.g., transfer_token_01h455vb4pex5vsknk084sn02q */
export type TransferTokenId = TypeId<'transfer_token'>

/** API key ID - e.g., api_key_01h455vb4pex5vsknk084sn02q */
export type ApiKeyId = TypeId<'api_key'>

/** Webhook ID - e.g., webhook_01h455vb4pex5vsknk084sn02q */
export type WebhookId = TypeId<'webhook'>

// ============================================
// Billing Entity IDs
// ============================================

/** Subscription ID - e.g., subscription_01h455vb4pex5vsknk084sn02q */
export type SubscriptionId = TypeId<'subscription'>

/** Invoice ID - e.g., invoice_01h455vb4pex5vsknk084sn02q */
export type InvoiceId = TypeId<'invoice'>

// ============================================
// Type Utilities
// ============================================

/**
 * Extract the prefix from a TypeId type
 */
export type ExtractPrefix<T extends string> = T extends `${infer P}_${string}` ? P : never

/**
 * Map from entity type to its TypeId type
 */
export interface EntityIdMap {
  post: PostId
  board: BoardId
  comment: CommentId
  vote: VoteId
  tag: TagId
  status: StatusId
  reaction: ReactionId
  post_edit: PostEditId
  comment_edit: CommentEditId
  note: NoteId
  segment: SegmentId
  user_attr: UserAttributeId
  sentiment: SentimentId
  feedback_source: FeedbackSourceId
  raw_feedback: RawFeedbackItemId
  feedback_signal: FeedbackSignalId
  feedback_suggestion: FeedbackSuggestionId
  signal_correction: FeedbackCorrectionId
  user_mapping: ExternalUserMappingId
  roadmap: RoadmapId
  changelog: ChangelogId
  integration: IntegrationId
  platform_cred: PlatformCredentialId
  event_mapping: EventMappingId
  linked_entity: LinkedEntityId
  sync_log: SyncLogId
  post_subscription: PostSubscriptionId
  notif_pref: NotifPrefId
  unsub_token: UnsubTokenId
  notification: NotificationId
  workspace: WorkspaceId
  user: UserId
  principal: PrincipalId
  session: SessionId
  account: AccountId
  invite: InviteId
  verification: VerificationId
  domain: DomainId
  transfer_token: TransferTokenId
  api_key: ApiKeyId
  webhook: WebhookId
  subscription: SubscriptionId
  invoice: InvoiceId
}

/**
 * Any TypeId (union of all entity ID types)
 */
export type AnyTypeId = EntityIdMap[keyof EntityIdMap]
