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

/** Post edit history ID - e.g., post_edit_01h455vb4pex5vsknk084sn02q */
export type PostEditId = TypeId<'post_edit'>

/** Comment edit history ID - e.g., comment_edit_01h455vb4pex5vsknk084sn02q */
export type CommentEditId = TypeId<'comment_edit'>

/** Internal staff note ID - e.g., note_01h455vb4pex5vsknk084sn02q */
export type NoteId = TypeId<'note'>

// ============================================
// Auth Entity IDs (Better-auth)
// ============================================

/** Workspace ID - e.g., workspace_01h455vb4pex5vsknk084sn02q */
export type WorkspaceId = TypeId<'workspace'>

/** User ID - e.g., user_01h455vb4pex5vsknk084sn02q */
export type UserId = TypeId<'user'>

/** Member ID - e.g., member_01h455vb4pex5vsknk084sn02q */
export type MemberId = TypeId<'member'>

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

// ============================================
// Billing Entity IDs
// ============================================

/** Subscription ID - e.g., subscription_01h455vb4pex5vsknk084sn02q */
export type SubscriptionId = TypeId<'subscription'>

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
  roadmap: RoadmapId
  changelog: ChangelogId
  integration: IntegrationId
  event_mapping: EventMappingId
  linked_entity: LinkedEntityId
  sync_log: SyncLogId
  post_subscription: PostSubscriptionId
  notif_pref: NotifPrefId
  unsub_token: UnsubTokenId
  workspace: WorkspaceId
  user: UserId
  member: MemberId
  session: SessionId
  account: AccountId
  invite: InviteId
  verification: VerificationId
  domain: DomainId
  transfer_token: TransferTokenId
  subscription: SubscriptionId
}

/**
 * Any TypeId (union of all entity ID types)
 */
export type AnyTypeId = EntityIdMap[keyof EntityIdMap]
