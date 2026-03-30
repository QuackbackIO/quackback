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

  // Planning domain
  roadmap: 'roadmap',
  changelog: 'changelog',

  // Help center
  helpcenter_category: 'helpcenter_category',
  helpcenter_article: 'helpcenter_article',
  helpcenter_feedback: 'helpcenter_feedback',

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
  signal_correction: 'signal_correction',
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
