/**
 * Standard Hook Names
 *
 * Defines all available hook points in the Quackback domain layer.
 * Using constants provides type safety and IDE autocomplete.
 */

/**
 * Standard hook names for the application
 * Organized by entity type (posts, comments, votes, etc.)
 */
export const HOOKS = {
  // ============================================
  // POST HOOKS
  // ============================================

  /** Filter: Transform/validate input before creating a post */
  POST_BEFORE_CREATE: 'post.beforeCreate',
  /** Validation: Validate post creation (can reject) */
  POST_VALIDATE_CREATE: 'post.validateCreate',
  /** Action: Execute after post is created */
  POST_AFTER_CREATE: 'post.afterCreate',

  /** Filter: Transform/validate input before updating a post */
  POST_BEFORE_UPDATE: 'post.beforeUpdate',
  /** Validation: Validate post update (can reject) */
  POST_VALIDATE_UPDATE: 'post.validateUpdate',
  /** Action: Execute after post is updated */
  POST_AFTER_UPDATE: 'post.afterUpdate',

  /** Filter: Transform status change before applying */
  POST_BEFORE_STATUS_CHANGE: 'post.beforeStatusChange',
  /** Validation: Validate status change (can reject) */
  POST_VALIDATE_STATUS_CHANGE: 'post.validateStatusChange',
  /** Action: Execute after post status changes */
  POST_AFTER_STATUS_CHANGE: 'post.afterStatusChange',

  /** Validation: Validate post deletion (can prevent) */
  POST_BEFORE_DELETE: 'post.beforeDelete',
  /** Action: Execute after post is deleted */
  POST_AFTER_DELETE: 'post.afterDelete',

  // ============================================
  // COMMENT HOOKS
  // ============================================

  /** Filter: Transform/validate input before creating a comment */
  COMMENT_BEFORE_CREATE: 'comment.beforeCreate',
  /** Validation: Validate comment creation (can reject) */
  COMMENT_VALIDATE_CREATE: 'comment.validateCreate',
  /** Action: Execute after comment is created */
  COMMENT_AFTER_CREATE: 'comment.afterCreate',

  /** Filter: Transform/validate input before updating a comment */
  COMMENT_BEFORE_UPDATE: 'comment.beforeUpdate',
  /** Validation: Validate comment update (can reject) */
  COMMENT_VALIDATE_UPDATE: 'comment.validateUpdate',
  /** Action: Execute after comment is updated */
  COMMENT_AFTER_UPDATE: 'comment.afterUpdate',

  /** Validation: Validate comment deletion (can prevent) */
  COMMENT_BEFORE_DELETE: 'comment.beforeDelete',
  /** Action: Execute after comment is deleted */
  COMMENT_AFTER_DELETE: 'comment.afterDelete',

  // ============================================
  // VOTE HOOKS
  // ============================================

  /** Filter: Transform/validate input before creating a vote */
  VOTE_BEFORE_CREATE: 'vote.beforeCreate',
  /** Validation: Validate vote creation (can reject) */
  VOTE_VALIDATE_CREATE: 'vote.validateCreate',
  /** Action: Execute after vote is created */
  VOTE_AFTER_CREATE: 'vote.afterCreate',

  /** Validation: Validate vote deletion (can prevent) */
  VOTE_BEFORE_DELETE: 'vote.beforeDelete',
  /** Action: Execute after vote is deleted */
  VOTE_AFTER_DELETE: 'vote.afterDelete',

  // ============================================
  // BOARD HOOKS
  // ============================================

  /** Filter: Transform/validate input before creating a board */
  BOARD_BEFORE_CREATE: 'board.beforeCreate',
  /** Validation: Validate board creation (can reject) */
  BOARD_VALIDATE_CREATE: 'board.validateCreate',
  /** Action: Execute after board is created */
  BOARD_AFTER_CREATE: 'board.afterCreate',

  /** Filter: Transform/validate input before updating a board */
  BOARD_BEFORE_UPDATE: 'board.beforeUpdate',
  /** Validation: Validate board update (can reject) */
  BOARD_VALIDATE_UPDATE: 'board.validateUpdate',
  /** Action: Execute after board is updated */
  BOARD_AFTER_UPDATE: 'board.afterUpdate',

  /** Validation: Validate board deletion (can prevent) */
  BOARD_BEFORE_DELETE: 'board.beforeDelete',
  /** Action: Execute after board is deleted */
  BOARD_AFTER_DELETE: 'board.afterDelete',

  // ============================================
  // MEMBER HOOKS
  // ============================================

  /** Filter: Transform/validate input before inviting a member */
  MEMBER_BEFORE_INVITE: 'member.beforeInvite',
  /** Validation: Validate member invitation (can reject) */
  MEMBER_VALIDATE_INVITE: 'member.validateInvite',
  /** Action: Execute after member is invited */
  MEMBER_AFTER_INVITE: 'member.afterInvite',

  /** Filter: Transform/validate input before updating member role */
  MEMBER_BEFORE_ROLE_CHANGE: 'member.beforeRoleChange',
  /** Validation: Validate role change (can reject) */
  MEMBER_VALIDATE_ROLE_CHANGE: 'member.validateRoleChange',
  /** Action: Execute after member role changes */
  MEMBER_AFTER_ROLE_CHANGE: 'member.afterRoleChange',

  /** Validation: Validate member removal (can prevent) */
  MEMBER_BEFORE_REMOVE: 'member.beforeRemove',
  /** Action: Execute after member is removed */
  MEMBER_AFTER_REMOVE: 'member.afterRemove',

  // ============================================
  // CHANGELOG HOOKS
  // ============================================

  /** Filter: Transform/validate input before publishing changelog */
  CHANGELOG_BEFORE_PUBLISH: 'changelog.beforePublish',
  /** Validation: Validate changelog publication (can reject) */
  CHANGELOG_VALIDATE_PUBLISH: 'changelog.validatePublish',
  /** Action: Execute after changelog is published */
  CHANGELOG_AFTER_PUBLISH: 'changelog.afterPublish',

  // ============================================
  // TAG HOOKS
  // ============================================

  /** Filter: Transform/validate input before creating a tag */
  TAG_BEFORE_CREATE: 'tag.beforeCreate',
  /** Validation: Validate tag creation (can reject) */
  TAG_VALIDATE_CREATE: 'tag.validateCreate',
  /** Action: Execute after tag is created */
  TAG_AFTER_CREATE: 'tag.afterCreate',

  /** Filter: Transform/validate input before updating a tag */
  TAG_BEFORE_UPDATE: 'tag.beforeUpdate',
  /** Validation: Validate tag update (can reject) */
  TAG_VALIDATE_UPDATE: 'tag.validateUpdate',
  /** Action: Execute after tag is updated */
  TAG_AFTER_UPDATE: 'tag.afterUpdate',

  /** Validation: Validate tag deletion (can prevent) */
  TAG_BEFORE_DELETE: 'tag.beforeDelete',
  /** Action: Execute after tag is deleted */
  TAG_AFTER_DELETE: 'tag.afterDelete',

  // ============================================
  // STATUS HOOKS
  // ============================================

  /** Filter: Transform/validate input before creating a status */
  STATUS_BEFORE_CREATE: 'status.beforeCreate',
  /** Validation: Validate status creation (can reject) */
  STATUS_VALIDATE_CREATE: 'status.validateCreate',
  /** Action: Execute after status is created */
  STATUS_AFTER_CREATE: 'status.afterCreate',

  /** Filter: Transform/validate input before updating a status */
  STATUS_BEFORE_UPDATE: 'status.beforeUpdate',
  /** Validation: Validate status update (can reject) */
  STATUS_VALIDATE_UPDATE: 'status.validateUpdate',
  /** Action: Execute after status is updated */
  STATUS_AFTER_UPDATE: 'status.afterUpdate',

  /** Validation: Validate status deletion (can prevent) */
  STATUS_BEFORE_DELETE: 'status.beforeDelete',
  /** Action: Execute after status is deleted */
  STATUS_AFTER_DELETE: 'status.afterDelete',
} as const

/**
 * Type-safe hook name type
 */
export type HookName = (typeof HOOKS)[keyof typeof HOOKS]

/**
 * Helper to check if a string is a valid hook name
 */
export function isValidHookName(name: string): name is HookName {
  const hookValues = Object.values(HOOKS)
  return hookValues.includes(name as HookName)
}
