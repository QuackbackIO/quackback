/**
 * Database types and constants for client components.
 *
 * Use this file when you need to import types or constants in client components
 * without triggering the server-side database initialization.
 *
 * @example
 * // In a client component:
 * import type { Board, Tag } from '@/lib/shared/db-types'
 * import { REACTION_EMOJIS } from '@/lib/shared/db-types'
 */

// Re-export types and constants (no side effects)
export * from '@quackback/db/types'

// Schema types needed by client components (type-only = no side effects)
export type {
  SegmentRules,
  SegmentCondition,
  SegmentRuleOperator,
  SegmentRuleAttribute,
} from '@quackback/db/schema'
