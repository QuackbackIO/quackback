/**
 * Domain Types Barrel
 *
 * This file re-exports foundational types and constants.
 * Domain-specific types (PublicPostDetail, TeamMember, etc.) are exported directly
 * from their respective module index files via index.ts.
 *
 * Import from '@quackback/domain' for all types - both foundational and domain-specific.
 */

// ============================================
// BUSINESS CONSTANTS & ENUMS (from db schema)
// ============================================
export {
  // Post status
  POST_STATUSES,
  type PostStatus,
  // Status categories
  STATUS_CATEGORIES,
  type StatusCategory,
  // Reaction emojis
  REACTION_EMOJIS,
  type ReactionEmoji,
} from '@quackback/db'

// ============================================
// STABLE DB ENTITY TYPES
// These are simple entities that map 1:1 with DB rows
// ============================================
export type {
  // Core entities
  Board,
  Tag,
  Member,
  Comment,
  Vote,
  Post,
  // Status entity (custom statuses)
  PostStatusEntity,
  // Composite DB types (for internal use)
  CommentReaction,
  // Settings
  BoardSettings,
} from '@quackback/db'

// Also re-export the helper function
export { getBoardSettings } from '@quackback/db'

// Note: Domain-specific types (CreatePostInput, PublicPostDetail, TeamMember, etc.)
// are exported from their respective module index files (./posts, ./boards, etc.)
// and re-exported via the main index.ts barrel.
