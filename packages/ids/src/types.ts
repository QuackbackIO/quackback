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
export type PostCommentId = TypeId<'post_comment'>

/** Vote ID - e.g., vote_01h455vb4pex5vsknk084sn02q */
export type PostVoteId = TypeId<'post_vote'>

/** PostTag ID - e.g., tag_01h455vb4pex5vsknk084sn02q */
export type PostTagId = TypeId<'post_tag'>

/** Post status ID - e.g., post_status_01h455vb4pex5vsknk084sn02q */
export type PostStatusId = TypeId<'post_status'>

/** Post comment reaction ID - e.g., post_comment_reaction_01h455vb4pex5vsknk084sn02q */
export type PostCommentReactionId = TypeId<'post_comment_reaction'>

/** Roadmap ID - e.g., roadmap_01h455vb4pex5vsknk084sn02q */
export type RoadmapId = TypeId<'roadmap'>

/** Changelog entry ID - e.g., changelog_01h455vb4pex5vsknk084sn02q */
export type ChangelogId = TypeId<'changelog'>

/** Changelog category (label) ID - e.g., changelog_category_01h455vb4pex5vsknk084sn02q */
export type ChangelogCategoryId = TypeId<'changelog_category'>

/** Changelog subscription ID - e.g., changelog_sub_01h455vb4pex5vsknk084sn02q */
export type ChangelogSubscriptionId = TypeId<'changelog_sub'>

/** Support-inbox conversation ID - e.g., conversation_01h455vb4pex5vsknk084sn02q */
export type ConversationId = TypeId<'conversation'>

/** Conversation message ID - e.g., conversation_msg_01h455vb4pex5vsknk084sn02q */
export type ConversationMessageId = TypeId<'conversation_msg'>

/** Conversation tag ID - e.g., conversation_tag_01h455vb4pex5vsknk084sn02q */
export type ConversationTagId = TypeId<'conversation_tag'>

/** Conversation message @-mention ID - e.g., conversation_msg_mention_01h455vb4pex5vsknk084sn02q */
export type ConversationMessageMentionId = TypeId<'conversation_msg_mention'>

/** Conversation message reaction ID - e.g., conversation_msg_reaction_01h455vb4pex5vsknk084sn02q */
export type ConversationMessageReactionId = TypeId<'conversation_msg_reaction'>

/** Integration ID - e.g., integration_01h455vb4pex5vsknk084sn02q */
export type IntegrationId = TypeId<'integration'>

/** Platform credential ID - e.g., platform_cred_01h455vb4pex5vsknk084sn02q */
export type PlatformCredentialId = TypeId<'platform_cred'>

/** Event mapping ID - e.g., event_mapping_01h455vb4pex5vsknk084sn02q */
export type EventMappingId = TypeId<'event_mapping'>

/** Post external link ID - e.g., post_external_link_01h455vb4pex5vsknk084sn02q */
export type PostExternalLinkId = TypeId<'post_external_link'>

/** Slack channel monitor ID - e.g., slack_monitor_01h455vb4pex5vsknk084sn02q */
export type SlackMonitorId = TypeId<'slack_monitor'>

/** Import run ID - e.g., import_run_01h455vb4pex5vsknk084sn02q */
export type ImportRunId = TypeId<'import_run'>

/** Post subscription ID - e.g., post_sub_01h455vb4pex5vsknk084sn02q */
export type PostSubscriptionId = TypeId<'post_sub'>

/** Notification preference ID - e.g., notif_pref_01h455vb4pex5vsknk084sn02q */
export type NotifPrefId = TypeId<'notif_pref'>

/** Unsubscribe token ID - e.g., unsub_token_01h455vb4pex5vsknk084sn02q */
export type UnsubTokenId = TypeId<'unsub_token'>

/** In-app notification ID - e.g., notification_01h455vb4pex5vsknk084sn02q */
export type NotificationId = TypeId<'notification'>

export type PushDeviceId = TypeId<'push_device'>

/** Post edit history ID - e.g., post_edit_01h455vb4pex5vsknk084sn02q */
export type PostEditId = TypeId<'post_edit'>

/** Comment edit history ID - e.g., post_comment_edit_01h455vb4pex5vsknk084sn02q */
export type PostCommentEditId = TypeId<'post_comment_edit'>

/** Post mention ID - e.g., post_mention_01h455vb4pex5vsknk084sn02q */
export type PostMentionId = TypeId<'post_mention'>

/** Internal staff note ID - e.g., post_note_01h455vb4pex5vsknk084sn02q */
export type PostNoteId = TypeId<'post_note'>

/** Segment ID - e.g., segment_01h455vb4pex5vsknk084sn02q */
export type SegmentId = TypeId<'segment'>

/** User attribute definition ID - e.g., user_attr_01h455vb4pex5vsknk084sn02q */
export type UserAttributeId = TypeId<'user_attr'>

/** Company attribute definition ID - e.g., company_attr_01h455vb4pex5vsknk084sn02q */
export type CompanyAttributeId = TypeId<'company_attr'>

// RBAC
export type RoleId = TypeId<'role'>
export type PermissionId = TypeId<'perm'>
export type RolePermissionId = TypeId<'role_perm'>
export type RoleAssignmentId = TypeId<'role_asgn'>

// ============================================
// AI Entity IDs
// ============================================

/** Post sentiment analysis ID - e.g., sentiment_01h455vb4pex5vsknk084sn02q */
export type SentimentId = TypeId<'sentiment'>

/** AI usage log entry ID - e.g., ailog_01h455vb4pex5vsknk084sn02q */
export type AiUsageLogId = TypeId<'ailog'>

/** Pipeline audit log entry ID - e.g., plog_01h455vb4pex5vsknk084sn02q */
export type PipelineLogId = TypeId<'plog'>

/** Post activity log ID - e.g., post_activity_01h455vb4pex5vsknk084sn02q */
export type PostActivityId = TypeId<'post_activity'>

/** Visitor analytics pageview ID - e.g., pv_01h455vb4pex5vsknk084sn02q */
export type PageViewId = TypeId<'pv'>

/** Company (B2B customer account) ID - e.g., company_01h455vb4pex5vsknk084sn02q */
export type CompanyId = TypeId<'company'>

/** Assistant involvement ID - e.g., assistant_involvement_01h455vb4pex5vsknk084sn02q */
export type AssistantInvolvementId = TypeId<'assistant_involvement'>

/** Assistant guidance rule ID - e.g., assistant_guidance_01h455vb4pex5vsknk084sn02q */
export type AssistantGuidanceRuleId = TypeId<'assistant_guidance'>

/** Assistant pending action ID - e.g., assistant_action_01h455vb4pex5vsknk084sn02q */
export type AssistantPendingActionId = TypeId<'assistant_action'>

/** Assistant tool-call audit ID - e.g., assistant_tool_call_01h455vb4pex5vsknk084sn02q */
export type AssistantToolCallId = TypeId<'assistant_tool_call'>

/** Assistant snippet ID - e.g., assistant_snippet_01h455vb4pex5vsknk084sn02q */
export type AssistantSnippetId = TypeId<'assistant_snippet'>

/** Data connector ID - e.g., data_connector_01h455vb4pex5vsknk084sn02q */
export type DataConnectorId = TypeId<'data_connector'>

/** Ticket ID - e.g., ticket_01h455vb4pex5vsknk084sn02q */
export type TicketId = TypeId<'ticket'>

/** Ticket status ID - e.g., ticket_status_01h455vb4pex5vsknk084sn02q */
export type TicketStatusId = TypeId<'ticket_status'>

/** Channel account ID (§4.8) - e.g., channel_account_01h455vb4pex5vsknk084sn02q */
export type ChannelAccountId = TypeId<'channel_account'>

/** Sending domain ID (§4.8) - e.g., sending_domain_01h455vb4pex5vsknk084sn02q */
export type SendingDomainId = TypeId<'sending_domain'>

/** Office-hours schedule ID (§4.6) - e.g., office_hours_01h455vb4pex5vsknk084sn02q */
export type OfficeHoursId = TypeId<'office_hours'>

/** SLA policy ID (§4.6) - e.g., sla_policy_01h455vb4pex5vsknk084sn02q */
export type SlaPolicyId = TypeId<'sla_policy'>

/** SLA event ID (§4.6) - e.g., sla_event_01h455vb4pex5vsknk084sn02q */
export type SlaEventId = TypeId<'sla_event'>

/** Conversation attribute definition ID - e.g., conv_attr_01h455vb4pex5vsknk084sn02q */
export type ConversationAttributeId = TypeId<'conv_attr'>

/** Workflow ID (§4.6) - e.g., workflow_01h455vb4pex5vsknk084sn02q */
export type WorkflowId = TypeId<'workflow'>

/** Workflow run ID (§4.6) - e.g., workflow_run_01h455vb4pex5vsknk084sn02q */
export type WorkflowRunId = TypeId<'workflow_run'>

/** Workflow run-event ID (§4.6) - e.g., workflow_run_event_01h455vb4pex5vsknk084sn02q */
export type WorkflowRunEventId = TypeId<'workflow_run_event'>

/** Team ID - e.g., team_01h455vb4pex5vsknk084sn02q */
export type TeamId = TypeId<'team'>

/** Team membership ID - e.g., team_member_01h455vb4pex5vsknk084sn02q */
export type TeamMemberId = TypeId<'team_member'>

/** Macro (canned reply with actions) ID - e.g., macro_01h455vb4pex5vsknk084sn02q */
export type MacroId = TypeId<'macro'>

/** Saved inbox view ID - e.g., conversation_view_01h455vb4pex5vsknk084sn02q */
export type ConversationViewId = TypeId<'conversation_view'>

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

/** External user mapping ID - e.g., user_mapping_01h455vb4pex5vsknk084sn02q */
export type ExternalUserMappingId = TypeId<'user_mapping'>

/** Merge suggestion ID - e.g., post_merge_sug_01h455vb4pex5vsknk084sn02q */
export type PostMergeSuggestionId = TypeId<'post_merge_sug'>

// ============================================
// Help Center Entity IDs
// ============================================

/** Help center category ID - e.g., kb_category_01h455vb4pex5vsknk084sn02q */
export type KbCategoryId = TypeId<'kb_category'>

/** Help center article ID - e.g., kb_article_01h455vb4pex5vsknk084sn02q */
export type KbArticleId = TypeId<'kb_article'>

/** Article feedback ID - e.g., kb_article_feedback_01h455vb4pex5vsknk084sn02q */
export type KbArticleFeedbackId = TypeId<'kb_article_feedback'>

/** Help center redirect rule ID - e.g., hc_redirect_rule_01h455vb4pex5vsknk084sn02q */
export type HcRedirectRuleId = TypeId<'hc_redirect_rule'>

/** Article translation ID - e.g., kb_article_translation_01h455vb4pex5vsknk084sn02q */
export type KbArticleTranslationId = TypeId<'kb_article_translation'>

/** Category translation ID - e.g., kb_category_translation_01h455vb4pex5vsknk084sn02q */
export type KbCategoryTranslationId = TypeId<'kb_category_translation'>

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

/** Two-factor enrolment ID - e.g., two_factor_01h455vb4pex5vsknk084sn02q */
export type TwoFactorId = TypeId<'two_factor'>

/** Audit log entry ID - e.g., audit_01h455vb4pex5vsknk084sn02q */
export type AuditLogId = TypeId<'audit'>

/** SSO recovery code ID - e.g., rcode_01h455vb4pex5vsknk084sn02q */
export type SsoRecoveryCodeId = TypeId<'rcode'>

/** Identity provider ID - e.g., idp_01h455vb4pex5vsknk084sn02q */
export type IdentityProviderId = TypeId<'idp'>

/** API key ID - e.g., api_key_01h455vb4pex5vsknk084sn02q */
export type ApiKeyId = TypeId<'api_key'>

/** Webhook ID - e.g., webhook_01h455vb4pex5vsknk084sn02q */
export type WebhookId = TypeId<'webhook'>

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
  post_comment: PostCommentId
  post_vote: PostVoteId
  post_tag: PostTagId
  post_status: PostStatusId
  post_comment_reaction: PostCommentReactionId
  post_edit: PostEditId
  post_comment_edit: PostCommentEditId
  post_mention: PostMentionId
  post_note: PostNoteId
  segment: SegmentId
  user_attr: UserAttributeId
  company_attr: CompanyAttributeId
  role: RoleId
  permission: PermissionId
  role_permission: RolePermissionId
  role_assignment: RoleAssignmentId
  sentiment: SentimentId
  ai_usage: AiUsageLogId
  pipeline_log: PipelineLogId
  post_activity: PostActivityId
  page_view: PageViewId
  company: CompanyId
  assistant_involvement: AssistantInvolvementId
  assistant_guidance: AssistantGuidanceRuleId
  assistant_action: AssistantPendingActionId
  assistant_tool_call: AssistantToolCallId
  assistant_snippet: AssistantSnippetId
  data_connector: DataConnectorId
  ticket: TicketId
  ticket_status: TicketStatusId
  channel_account: ChannelAccountId
  sending_domain: SendingDomainId
  office_hours: OfficeHoursId
  sla_policy: SlaPolicyId
  sla_event: SlaEventId
  workflow: WorkflowId
  workflow_run: WorkflowRunId
  workflow_run_event: WorkflowRunEventId
  team: TeamId
  team_member: TeamMemberId
  macro: MacroId
  conversation_view: ConversationViewId
  conversation_attribute: ConversationAttributeId
  feedback_source: FeedbackSourceId
  raw_feedback: RawFeedbackItemId
  feedback_signal: FeedbackSignalId
  feedback_suggestion: FeedbackSuggestionId

  user_mapping: ExternalUserMappingId
  post_merge_suggestion: PostMergeSuggestionId
  roadmap: RoadmapId
  changelog: ChangelogId
  changelog_category: ChangelogCategoryId
  changelog_sub: ChangelogSubscriptionId
  conversation: ConversationId
  conversation_message: ConversationMessageId
  conversation_tag: ConversationTagId
  conversation_message_mention: ConversationMessageMentionId
  conversation_message_reaction: ConversationMessageReactionId
  integration: IntegrationId
  platform_cred: PlatformCredentialId
  event_mapping: EventMappingId
  post_external_link: PostExternalLinkId
  slack_monitor: SlackMonitorId
  import_run: ImportRunId
  post_subscription: PostSubscriptionId
  notif_pref: NotifPrefId
  unsub_token: UnsubTokenId
  notification: NotificationId
  push_device: PushDeviceId
  workspace: WorkspaceId
  user: UserId
  principal: PrincipalId
  session: SessionId
  account: AccountId
  invite: InviteId
  verification: VerificationId
  domain: DomainId
  transfer_token: TransferTokenId
  two_factor: TwoFactorId
  audit_log: AuditLogId
  sso_recovery_code: SsoRecoveryCodeId
  identity_provider: IdentityProviderId
  api_key: ApiKeyId
  webhook: WebhookId
  kb_category: KbCategoryId
  kb_article: KbArticleId
  kb_article_feedback: KbArticleFeedbackId
  hc_redirect_rule: HcRedirectRuleId
  kb_article_translation: KbArticleTranslationId
  kb_category_translation: KbCategoryTranslationId
}

/**
 * Any TypeId (union of all entity ID types)
 */
export type AnyTypeId = EntityIdMap[keyof EntityIdMap]
