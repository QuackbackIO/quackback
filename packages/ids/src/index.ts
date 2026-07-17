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
  PostCommentId,
  PostVoteId,
  PostTagId,
  PostStatusId,
  PostCommentReactionId,
  ConversationMessageReactionId,
  PostEditId,
  PostCommentEditId,
  PostMentionId,
  PostNoteId,
  RoadmapId,
  RoadmapColumnId,
  ChangelogId,
  ChangelogCategoryId,
  ChangelogSubscriptionId,
  StatusComponentId,
  StatusComponentGroupId,
  StatusIncidentId,
  StatusUpdateId,
  StatusSubscriptionId,
  StatusIncidentTemplateId,
  ConversationId,
  ConversationMessageId,
  ConversationTagId,
  ConversationMessageMentionId,
  ConversationSummaryId,
  ConversationMessageTranslationId,
  IntegrationId,
  PlatformCredentialId,
  EventMappingId,
  PostExternalLinkId,
  TicketExternalLinkId,
  ImportRunId,
  ExportRunId,
  PostSubscriptionId,
  NotifPrefId,
  UnsubTokenId,
  NotificationId,
  // User segmentation
  SegmentId,
  UserAttributeId,
  CompanyAttributeId,
  // AI entities
  SentimentId,
  PostActivityId,
  // Support platform entities
  CompanyId,
  TeamId,
  TeamMemberId,
  MacroId,
  ConversationViewId,
  ConversationAttributeId,
  AssistantInvolvementId,
  AssistantGuidanceRuleId,
  AssistantPendingActionId,
  AssistantCustomActionId,
  AssistantToolCallId,
  AssistantSnippetId,
  TicketId,
  TicketStatusId,
  TicketActivityId,
  TicketSummaryId,
  ChannelAccountId,
  SendingDomainId,
  OfficeHoursId,
  SlaPolicyId,
  SlaEventId,
  WorkflowId,
  WorkflowRunId,
  WorkflowRunEventId,
  WorkflowVersionId,
  // Feedback aggregation entities
  FeedbackSourceId,
  RawFeedbackItemId,
  FeedbackSignalId,
  FeedbackSuggestionId,
  ExternalUserMappingId,
  PostMergeSuggestionId,
  // Help center entities
  KbCategoryId,
  KbArticleId,
  KbArticleFeedbackId,
  HcRedirectRuleId,
  KbArticleTranslationId,
  KbCategoryTranslationId,
  // Auth entities
  WorkspaceId,
  UserId,
  PrincipalId,
  SessionId,
  AccountId,
  InviteId,
  VerificationId,
  DomainId,
  TransferTokenId,
  AuditLogId,
  SsoRecoveryCodeId,
  IdentityProviderId,
  ApiKeyId,
  WebhookId,
  // Eventing
  EvtId,
  // App platform
  AppId,
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
  postStatusIdSchema,
  postCommentReactionIdSchema,
  conversationMessageReactionIdSchema,
  roadmapIdSchema,
  roadmapColumnIdSchema,
  changelogIdSchema,
  conversationIdSchema,
  conversationMessageIdSchema,
  integrationIdSchema,
  workspaceIdSchema,
  userIdSchema,
  principalIdSchema,
  sessionIdSchema,
  inviteIdSchema,
  domainIdSchema,
  segmentIdSchema,
  importRunIdSchema,
  exportRunIdSchema,
  // Pre-built strict schemas - feedback aggregation
  feedbackSourceIdSchema,
  rawFeedbackItemIdSchema,
  feedbackSignalIdSchema,
  externalUserMappingIdSchema,
  // Pre-built flexible schemas
  flexibleSegmentIdSchema,
  flexiblePostIdSchema,
  flexibleBoardIdSchema,
  flexibleCommentIdSchema,
  flexibleVoteIdSchema,
  flexibleTagIdSchema,
  flexiblePostStatusIdSchema,
  flexiblePostCommentReactionIdSchema,
  flexibleConversationMessageReactionIdSchema,
  flexibleRoadmapIdSchema,
  flexibleRoadmapColumnIdSchema,
  flexibleChangelogIdSchema,
  flexibleIntegrationIdSchema,
  flexibleWorkspaceIdSchema,
  flexibleUserIdSchema,
  flexiblePrincipalIdSchema,
  flexibleSessionIdSchema,
  flexibleInviteIdSchema,
  flexibleDomainIdSchema,
  // Pre-built flexible schemas - feedback aggregation
  flexibleFeedbackSourceIdSchema,
  flexibleRawFeedbackItemIdSchema,
  flexibleFeedbackSignalIdSchema,
  flexibleExternalUserMappingIdSchema,
  // Array schemas
  tagIdsSchema,
  postIdsSchema,
} from './zod'
