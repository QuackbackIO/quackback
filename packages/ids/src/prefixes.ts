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
  post_comment: 'post_comment',
  post_vote: 'post_vote',
  post_tag: 'post_tag',
  post_status: 'post_status',
  post_comment_reaction: 'post_comment_reaction',
  post_edit: 'post_edit',
  post_comment_edit: 'post_comment_edit',
  note: 'note', // Internal staff notes on posts
  post_mention: 'post_mention',

  // Planning domain
  roadmap: 'roadmap',
  changelog: 'changelog',

  // Live chat
  conversation: 'conversation',
  conversation_message: 'conversation_msg',
  conversation_tag: 'conversation_tag',
  conversation_message_mention: 'conversation_msg_mention',
  conversation_message_reaction: 'conversation_msg_reaction',

  // Help center
  category: 'category',
  article: 'article',
  article_feedback: 'article_feedback',

  // Integrations
  integration: 'integration',
  platform_cred: 'platform_cred',
  event_mapping: 'event_mapping',
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

  // RBAC (roles + permissions)
  role: 'role',
  permission: 'perm',
  role_permission: 'role_perm',
  role_assignment: 'role_asgn',

  // Users
  segment: 'segment',
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
  audit_log: 'audit',
  sso_recovery_code: 'rcode',
  identity_provider: 'idp',

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
