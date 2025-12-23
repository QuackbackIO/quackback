/**
 * @quackback/ids - TypeID generation and validation for Quackback
 *
 * TypeID is a type-safe, sortable identifier format that combines:
 * - Stripe-like prefixes for instant entity recognition
 * - UUIDv7 for time-ordered, database-optimized IDs
 *
 * Format: {prefix}_{base32_encoded_uuidv7}
 * Example: post_01h455vb4pex5vsknk084sn02q
 *
 * @example
 * import { generateId, toUuid, fromUuid, isValidTypeId } from '@quackback/ids'
 *
 * // Generate a new TypeID
 * const postId = generateId('post')
 * // => 'post_01h455vb4pex5vsknk084sn02q'
 *
 * // Convert to UUID for database
 * const uuid = toUuid(postId)
 * // => '01893d8c-7e80-7000-8000-000000000000'
 *
 * // Convert back to TypeID
 * const restored = fromUuid('post', uuid)
 * // => 'post_01h455vb4pex5vsknk084sn02q'
 *
 * @packageDocumentation
 */

// ============================================
// Core Functions
// ============================================

export {
  // Generation
  generateId,
  createId,
  // Conversion
  toUuid,
  fromUuid,
  parseTypeId,
  getTypeIdPrefix,
  // Validation
  isValidTypeId,
  isTypeId,
  isUuid,
  isTypeIdFormat,
  // Batch operations
  batchFromUuid,
  batchToUuid,
  // Flexible handling
  normalizeToUuid,
  ensureTypeId,
} from './core'

// ============================================
// Prefixes
// ============================================

export { ID_PREFIXES, getPrefix, isValidPrefix, type IdPrefix, type EntityType } from './prefixes'

// ============================================
// Types
// ============================================

export type {
  TypeId,
  // Application entities
  PostId,
  BoardId,
  CommentId,
  VoteId,
  TagId,
  StatusId,
  ReactionId,
  RoadmapId,
  ChangelogId,
  IntegrationId,
  EventMappingId,
  LinkedEntityId,
  SyncLogId,
  PostSubscriptionId,
  NotifPrefId,
  UnsubTokenId,
  // Auth entities
  WorkspaceId,
  UserId,
  MemberId,
  SessionId,
  AccountId,
  InviteId,
  VerificationId,
  DomainId,
  TransferTokenId,
  // Billing
  SubscriptionId,
  // Utilities
  ExtractPrefix,
  EntityIdMap,
  AnyTypeId,
} from './types'

// ============================================
// Re-export Zod schemas from submodule
// ============================================

// Note: For tree-shaking, import directly from '@quackback/ids/zod'
// These are re-exported here for convenience

export {
  // Schema factories
  typeIdSchema,
  flexibleIdSchema,
  flexibleToTypeIdSchema,
  typeIdArraySchema,
  flexibleIdArraySchema,
  // Generic schemas
  anyTypeIdSchema,
  uuidSchema,
  // Pre-built strict schemas
  postIdSchema,
  boardIdSchema,
  commentIdSchema,
  voteIdSchema,
  tagIdSchema,
  statusIdSchema,
  reactionIdSchema,
  roadmapIdSchema,
  changelogIdSchema,
  integrationIdSchema,
  workspaceIdSchema,
  userIdSchema,
  memberIdSchema,
  sessionIdSchema,
  inviteIdSchema,
  subscriptionIdSchema,
  domainIdSchema,
  // Pre-built flexible schemas
  flexiblePostIdSchema,
  flexibleBoardIdSchema,
  flexibleCommentIdSchema,
  flexibleVoteIdSchema,
  flexibleTagIdSchema,
  flexibleStatusIdSchema,
  flexibleReactionIdSchema,
  flexibleRoadmapIdSchema,
  flexibleChangelogIdSchema,
  flexibleIntegrationIdSchema,
  flexibleWorkspaceIdSchema,
  flexibleUserIdSchema,
  flexibleMemberIdSchema,
  flexibleSessionIdSchema,
  flexibleInviteIdSchema,
  flexibleSubscriptionIdSchema,
  flexibleDomainIdSchema,
  // Array schemas
  tagIdsSchema,
  postIdsSchema,
} from './zod'
