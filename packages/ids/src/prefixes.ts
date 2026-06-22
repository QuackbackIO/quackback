/**
 * TypeID prefix definitions for all entity types
 *
 * Convention: lowercase, singular nouns, descriptive but concise
 * Format: {prefix}_{base32_encoded_uuidv7}
 *
 * @example post_01h455vb4pex5vsknk084sn02q
 */
export const ID_PREFIXES = {
  // ============================================
  // Application Entities (UUID primary keys)
  // ============================================

  // Feedback domain
  post: 'post',
  board: 'board',
  comment: 'comment',
  vote: 'vote',
  tag: 'tag',
  status: 'status',
  reaction: 'reaction',
  post_edit: 'post_edit',
  comment_edit: 'comment_edit',
  note: 'note', // Internal staff notes on posts
  post_mention: 'post_mention',

  // Planning domain
  roadmap: 'roadmap',
  changelog: 'changelog',
  changelog_category: 'changelog_cat',
  changelog_product: 'changelog_prod',
  changelog_segment_visibility: 'clseg_vis',

  // Widget embedding
  widget_application: 'widget_app',
  widget_profile: 'widget_profile',

  // Live chat
  conversation: 'conversation',
  chat_message: 'chat_msg',
  chat_tag: 'chat_tag',
  chat_message_mention: 'chat_msg_mention',

  // Help center
  category: 'category',
  article: 'article',
  article_feedback: 'article_feedback',

  // Integrations
  integration: 'integration',
  platform_cred: 'platform_cred',
  event_mapping: 'event_mapping',
  // Shared prefix for both post_external_links and ticket_external_links.
  // Same semantic concept (external tracker link); separate FK columns disambiguate.
  linked_entity: 'linked_entity',
  sync_log: 'sync_log',
  slack_monitor: 'slack_monitor',

  // Notifications
  post_subscription: 'post_sub',
  notif_pref: 'notif_pref',
  unsub_token: 'unsub_token',
  notification: 'notification',

  // Push devices (mobile agent app — APNs/FCM token registry)
  push_device: 'push_device',

  // Users
  segment: 'segment',
  portal_tab_override: 'portal_tab_override',
  user_attr: 'user_attr',

  // AI
  sentiment: 'sentiment',
  ai_usage: 'ailog',
  pipeline_log: 'plog',

  // Feedback aggregation
  feedback_source: 'feedback_source',
  raw_feedback: 'raw_feedback',
  feedback_signal: 'feedback_signal',
  feedback_suggestion: 'feedback_suggestion',

  user_mapping: 'user_mapping',
  merge_suggestion: 'merge_sug',
  activity: 'activity',

  // Ticketing — access & visibility (Phase 1: RBAC + teams + audit)
  team: 'team',
  team_membership: 'team_member',
  role: 'role',
  permission: 'perm',
  role_permission: 'role_perm',
  role_assignment: 'role_asgn',
  // Shares 'audit' prefix with audit_log (better-auth security events).
  // Both store UUIDs internally; prefix is display-layer only. Safe because no
  // code resolves entity type from a TypeID prefix string across tables.
  audit_event: 'audit',

  // Ticketing — Phase 2: organizations & contacts
  organization: 'org',
  contact: 'contact',
  contact_user_link: 'cu_link',

  // Ticketing — Phase 3: ticket core
  ticket: 'ticket',
  ticket_status: 'ticket_status',
  ticket_thread: 'ticket_thread',
  ticket_attachment: 'ticket_att',
  ticket_participant: 'ticket_part',
  ticket_share: 'ticket_share',
  ticket_activity: 'ticket_act',

  // Ticketing — Phase 4: inboxes, channels, routing
  inbox: 'inbox',
  inbox_channel: 'inbox_ch',
  inbox_membership: 'inbox_mem',
  routing_rule: 'route_rule',

  // Ticketing — Phase 5: SLA + escalations
  business_hours: 'bizhrs',
  sla_policy: 'sla_pol',
  sla_target: 'sla_tgt',
  ticket_sla_clock: 'sla_clk',
  escalation_rule: 'esc_rule',
  sla_escalation_log: 'esc_log',

  // Ticketing — Phase 7: subscriptions + webhook delivery log
  ticket_subscription: 'tkt_sub',
  webhook_delivery: 'wh_deliv',

  // ============================================
  // Auth Entities (Better-auth, text primary keys)
  // ============================================

  workspace: 'workspace',
  user: 'user',
  principal: 'principal',
  session: 'session',
  account: 'account',
  invite: 'invite',
  verification: 'verification',
  domain: 'domain',
  transfer_token: 'transfer_token',
  two_factor: 'two_factor',
  // Shares 'audit' prefix with audit_event (ticketing operational audit).
  // See audit_event comment for rationale.
  audit_log: 'audit',
  sso_recovery_code: 'rcode',

  // ============================================
  // Billing
  // ============================================

  subscription: 'subscription',
  invoice: 'invoice',

  // ============================================
  // API
  // ============================================

  api_key: 'api_key',
  webhook: 'webhook',
} as const

/**
 * Type representing any valid ID prefix
 */
export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES]

/**
 * Type representing entity type keys (for lookup)
 */
export type EntityType = keyof typeof ID_PREFIXES

/**
 * Get the prefix for a given entity type
 */
export function getPrefix(entity: EntityType): IdPrefix {
  return ID_PREFIXES[entity]
}

/**
 * Check if a string is a valid prefix
 */
export function isValidPrefix(prefix: string): prefix is IdPrefix {
  return Object.values(ID_PREFIXES).includes(prefix as IdPrefix)
}
