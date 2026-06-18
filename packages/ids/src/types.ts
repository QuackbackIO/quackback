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

/** Changelog category ID - e.g., changelog_cat_01h455vb4pex5vsknk084sn02q */
export type ChangelogCategoryId = TypeId<'changelog_cat'>

/** Changelog product ID - e.g., changelog_prod_01h455vb4pex5vsknk084sn02q */
export type ChangelogProductId = TypeId<'changelog_prod'>

/** Per-segment changelog visibility override ID - e.g., clseg_vis_01h455vb4pex5vsknk084sn02q */
export type ChangelogSegmentVisibilityId = TypeId<'clseg_vis'>

/** Widget application ID - e.g., widget_app_01h455vb4pex5vsknk084sn02q */
export type WidgetApplicationId = TypeId<'widget_app'>

/** Widget environment profile ID - e.g., widget_profile_01h455vb4pex5vsknk084sn02q */
export type WidgetProfileId = TypeId<'widget_profile'>

/** Support-inbox conversation ID - e.g., conversation_01h455vb4pex5vsknk084sn02q */
export type ConversationId = TypeId<'conversation'>

/** Support-inbox message ID - e.g., chat_msg_01h455vb4pex5vsknk084sn02q */
export type ChatMessageId = TypeId<'chat_msg'>

/** Conversation tag ("label") ID - e.g., chat_tag_01h455vb4pex5vsknk084sn02q */
export type ChatTagId = TypeId<'chat_tag'>

/** Chat-message @-mention ID - e.g., chat_msg_mention_01h455vb4pex5vsknk084sn02q */
export type ChatMessageMentionId = TypeId<'chat_msg_mention'>

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

/** Slack channel monitor ID - e.g., slack_monitor_01h455vb4pex5vsknk084sn02q */
export type SlackMonitorId = TypeId<'slack_monitor'>

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

/** Comment edit history ID - e.g., comment_edit_01h455vb4pex5vsknk084sn02q */
export type CommentEditId = TypeId<'comment_edit'>

/** Post mention ID - e.g., post_mention_01h455vb4pex5vsknk084sn02q */
export type PostMentionId = TypeId<'post_mention'>

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

/** AI usage log entry ID - e.g., ailog_01h455vb4pex5vsknk084sn02q */
export type AiUsageLogId = TypeId<'ailog'>

/** Pipeline audit log entry ID - e.g., plog_01h455vb4pex5vsknk084sn02q */
export type PipelineLogId = TypeId<'plog'>

/** Post activity log ID - e.g., activity_01h455vb4pex5vsknk084sn02q */
export type ActivityId = TypeId<'activity'>

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

/** Merge suggestion ID - e.g., merge_sug_01h455vb4pex5vsknk084sn02q */
export type MergeSuggestionId = TypeId<'merge_sug'>

// ============================================
// Help Center Entity IDs
// ============================================

/** Help center category ID - e.g., category_01h455vb4pex5vsknk084sn02q */
export type HelpCenterCategoryId = TypeId<'category'>

/** Help center article ID - e.g., article_01h455vb4pex5vsknk084sn02q */
export type HelpCenterArticleId = TypeId<'article'>

/** Article feedback ID - e.g., article_feedback_01h455vb4pex5vsknk084sn02q */
export type HelpCenterFeedbackId = TypeId<'article_feedback'>

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

/** API key ID - e.g., api_key_01h455vb4pex5vsknk084sn02q */
export type ApiKeyId = TypeId<'api_key'>

/** Webhook ID - e.g., webhook_01h455vb4pex5vsknk084sn02q */
export type WebhookId = TypeId<'webhook'>

// ============================================
// Ticketing — RBAC, teams, audit (Phase 1)
// ============================================

/** Team ID - e.g., team_01h455vb4pex5vsknk084sn02q */
export type TeamId = TypeId<'team'>

/** Team membership ID - e.g., team_member_01h455vb4pex5vsknk084sn02q */
export type TeamMembershipId = TypeId<'team_member'>

/** Role ID - e.g., role_01h455vb4pex5vsknk084sn02q */
export type RoleId = TypeId<'role'>

/** Permission ID - e.g., perm_01h455vb4pex5vsknk084sn02q */
export type PermissionId = TypeId<'perm'>

/** Role-permission grant ID - e.g., role_perm_01h455vb4pex5vsknk084sn02q */
export type RolePermissionId = TypeId<'role_perm'>

/** Principal role assignment ID - e.g., role_asgn_01h455vb4pex5vsknk084sn02q */
export type RoleAssignmentId = TypeId<'role_asgn'>

/** Audit event ID - e.g., audit_01h455vb4pex5vsknk084sn02q */
export type AuditEventId = TypeId<'audit'>

// ============================================
// Ticketing — Phase 2: organizations & contacts
// ============================================

/** Organization ID - e.g., org_01h455vb4pex5vsknk084sn02q */
export type OrganizationId = TypeId<'org'>

/** Contact ID - e.g., contact_01h455vb4pex5vsknk084sn02q */
export type ContactId = TypeId<'contact'>

/** Contact ↔ portal user link ID - e.g., cu_link_01h455vb4pex5vsknk084sn02q */
export type ContactUserLinkId = TypeId<'cu_link'>

// ============================================
// Ticketing — Phase 3: ticket core
// ============================================

/** Ticket ID - e.g., ticket_01h455vb4pex5vsknk084sn02q */
export type TicketId = TypeId<'ticket'>

/** Ticket status ID - e.g., ticket_status_01h455vb4pex5vsknk084sn02q */
export type TicketStatusId = TypeId<'ticket_status'>

/** Ticket thread (message) ID - e.g., ticket_thread_01h455vb4pex5vsknk084sn02q */
export type TicketThreadId = TypeId<'ticket_thread'>

/** Ticket attachment ID - e.g., ticket_att_01h455vb4pex5vsknk084sn02q */
export type TicketAttachmentId = TypeId<'ticket_att'>

/** Ticket participant (watcher/collaborator/cc) ID - e.g., ticket_part_01h455vb4pex5vsknk084sn02q */
export type TicketParticipantId = TypeId<'ticket_part'>

/** Ticket share grant ID - e.g., ticket_share_01h455vb4pex5vsknk084sn02q */
export type TicketShareId = TypeId<'ticket_share'>

/** Ticket activity event ID - e.g., ticket_act_01h455vb4pex5vsknk084sn02q */
export type TicketActivityId = TypeId<'ticket_act'>

// ============================================
// Ticketing — Inboxes, channels, routing (Phase 4)
// ============================================

/** Inbox ID - e.g., inbox_01h455vb4pex5vsknk084sn02q */
export type InboxId = TypeId<'inbox'>

/** Inbox channel ID - e.g., inbox_ch_01h455vb4pex5vsknk084sn02q */
export type InboxChannelId = TypeId<'inbox_ch'>

/** Inbox membership ID - e.g., inbox_mem_01h455vb4pex5vsknk084sn02q */
export type InboxMembershipId = TypeId<'inbox_mem'>

/** Routing rule ID - e.g., route_rule_01h455vb4pex5vsknk084sn02q */
export type RoutingRuleId = TypeId<'route_rule'>

// ============================================
// Ticketing — SLA + escalations (Phase 5)
// ============================================

/** Business hours calendar ID - e.g., bizhrs_01h455vb4pex5vsknk084sn02q */
export type BusinessHoursId = TypeId<'bizhrs'>

/** SLA policy ID - e.g., sla_pol_01h455vb4pex5vsknk084sn02q */
export type SlaPolicyId = TypeId<'sla_pol'>

/** SLA target ID - e.g., sla_tgt_01h455vb4pex5vsknk084sn02q */
export type SlaTargetId = TypeId<'sla_tgt'>

/** Per-ticket SLA clock ID - e.g., sla_clk_01h455vb4pex5vsknk084sn02q */
export type TicketSlaClockId = TypeId<'sla_clk'>

/** Escalation rule ID - e.g., esc_rule_01h455vb4pex5vsknk084sn02q */
export type EscalationRuleId = TypeId<'esc_rule'>

/** SLA escalation log entry ID - e.g., esc_log_01h455vb4pex5vsknk084sn02q */
export type SlaEscalationLogId = TypeId<'esc_log'>

/** Per-ticket subscription ID - e.g., tkt_sub_01h455vb4pex5vsknk084sn02q */
export type TicketSubscriptionId = TypeId<'tkt_sub'>

/** Webhook delivery attempt ID - e.g., wh_deliv_01h455vb4pex5vsknk084sn02q */
export type WebhookDeliveryId = TypeId<'wh_deliv'>

/** Portal tab segment override ID - e.g., portal_tab_override_01h455vb4pex5vsknk084sn02q */
export type PortalTabOverrideId = TypeId<'portal_tab_override'>

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
  post_mention: PostMentionId
  note: NoteId
  segment: SegmentId
  user_attr: UserAttributeId
  sentiment: SentimentId
  ai_usage: AiUsageLogId
  pipeline_log: PipelineLogId
  activity: ActivityId
  feedback_source: FeedbackSourceId
  raw_feedback: RawFeedbackItemId
  feedback_signal: FeedbackSignalId
  feedback_suggestion: FeedbackSuggestionId

  user_mapping: ExternalUserMappingId
  merge_suggestion: MergeSuggestionId
  roadmap: RoadmapId
  changelog: ChangelogId
  changelog_category: ChangelogCategoryId
  changelog_product: ChangelogProductId
  changelog_segment_visibility: ChangelogSegmentVisibilityId
  widget_application: WidgetApplicationId
  widget_profile: WidgetProfileId
  conversation: ConversationId
  chat_message: ChatMessageId
  chat_tag: ChatTagId
  chat_message_mention: ChatMessageMentionId
  integration: IntegrationId
  platform_cred: PlatformCredentialId
  event_mapping: EventMappingId
  linked_entity: LinkedEntityId
  sync_log: SyncLogId
  slack_monitor: SlackMonitorId
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
  api_key: ApiKeyId
  webhook: WebhookId
  subscription: SubscriptionId
  invoice: InvoiceId
  category: HelpCenterCategoryId
  article: HelpCenterArticleId
  article_feedback: HelpCenterFeedbackId

  // Ticketing — Phase 1
  team: TeamId
  team_membership: TeamMembershipId
  role: RoleId
  permission: PermissionId
  role_permission: RolePermissionId
  role_assignment: RoleAssignmentId
  audit_event: AuditEventId

  // Ticketing — Phase 2
  organization: OrganizationId
  contact: ContactId
  contact_user_link: ContactUserLinkId

  // Ticketing — Phase 3
  ticket: TicketId
  ticket_status: TicketStatusId
  ticket_thread: TicketThreadId
  ticket_attachment: TicketAttachmentId
  ticket_participant: TicketParticipantId
  ticket_share: TicketShareId
  ticket_activity: TicketActivityId

  // Ticketing — Phase 4
  inbox: InboxId
  inbox_channel: InboxChannelId
  inbox_membership: InboxMembershipId
  routing_rule: RoutingRuleId

  // Ticketing — Phase 5
  business_hours: BusinessHoursId
  sla_policy: SlaPolicyId
  sla_target: SlaTargetId
  ticket_sla_clock: TicketSlaClockId
  escalation_rule: EscalationRuleId
  sla_escalation_log: SlaEscalationLogId

  // Ticketing — Phase 7
  ticket_subscription: TicketSubscriptionId
  webhook_delivery: WebhookDeliveryId

  // Portal tab configuration
  portal_tab_override: PortalTabOverrideId
}

/**
 * Any TypeId (union of all entity ID types)
 */
export type AnyTypeId = EntityIdMap[keyof EntityIdMap]
