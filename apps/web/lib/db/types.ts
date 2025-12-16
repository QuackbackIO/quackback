/**
 * Database types and constants for client components.
 *
 * Use this file when you need to import types or constants in client components
 * without triggering the server-side database initialization.
 *
 * @example
 * // In a client component:
 * import type { Board, Tag } from '@/lib/db/types'
 * import { REACTION_EMOJIS } from '@/lib/db/types'
 */

// Re-export types and constants (no side effects)
export * from '@quackback/db/types'
