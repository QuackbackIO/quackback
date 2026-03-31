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

import type { SetupState } from '@quackback/db/types'

// Re-export types only to keep this module client-safe.
export type * from '@quackback/db/types'

// Schema types needed by client components (type-only = no side effects)
export type {
  SegmentRules,
  SegmentCondition,
  SegmentRuleOperator,
  SegmentRuleAttribute,
  EvaluationSchedule,
  SegmentWeightConfig,
  UserAttributeDefinition,
  UserAttributeType,
  CurrencyCode,
} from '@quackback/db/schema'

// Runtime exports used in client components.
export const REACTION_EMOJIS = ['👍', '❤️', '🎉', '😄', '🤔', '👀'] as const
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number]

export function getSetupState(setupStateJson: string | null): SetupState | null {
  if (!setupStateJson) return null
  try {
    return JSON.parse(setupStateJson) as SetupState
  } catch {
    return null
  }
}

export function isOnboardingComplete(setupState: SetupState | null): boolean {
  if (!setupState) return false
  return setupState.steps.core && setupState.steps.workspace && setupState.steps.boards
}
