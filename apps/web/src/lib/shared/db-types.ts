/**
 * Database types and constants for client components.
 *
 * Use this file when you need to import types or constants in client components
 * without triggering the server-side database initialization.
 *
 * @example
 * // In a client component:
 * import type { Board, PostTag } from '@/lib/shared/db-types'
 * import { REACTION_EMOJIS } from '@/lib/shared/db-types'
 */

import {
  getSetupState as getSetupStateFromDb,
  isOnboardingComplete as isOnboardingCompleteFromDb,
  normalizeOnboardingOutcome as normalizeOnboardingOutcomeFromDb,
  type SetupState,
  type UseCaseType,
  type OnboardingOutcome,
} from '@quackback/db/types'

// Re-export types only to keep this module client-safe.
export type * from '@quackback/db/types'

// Plain-data constants from @quackback/db/types are also safe (no runtime side
// effects) and let client code stay aligned with the schema defaults.
export {
  ACCESS_TIERS,
  ACCESS_TIER_RANK,
  DEFAULT_BOARD_ACCESS,
  MODERATION_RULE_VALUES,
  CONVERSATION_STATUSES,
  CONVERSATION_END_REASONS,
  CONVERSATION_PRIORITIES,
  TEAM_ASSIGNMENT_METHODS,
  TICKET_TYPES,
  TICKET_STATUS_CATEGORIES,
  TICKET_STAGES,
  USE_CASE_TYPES,
  ONBOARDING_OUTCOMES,
  INTERACTIVE_BLOCK_KINDS,
  CSAT_FACES,
} from '@quackback/db/types'
export type {
  AccessTier,
  BoardAccess,
  ModerationRuleValue,
  ConversationEndReason,
  TeamAssignmentMethod,
  TicketType,
  TicketStatusCategory,
  TicketStage,
  UseCaseType,
  OnboardingOutcome,
  SetupState,
} from '@quackback/db/types'

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
  MacroScope,
  MacroPriority,
  MacroSnoozePreset,
  MacroAction,
} from '@quackback/db/schema'

// Runtime exports used in client components.
export const REACTION_EMOJIS = ['👍', '❤️', '🎉', '😄', '🤔', '👀'] as const
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number]

export function getSetupState(setupStateJson: string | null): SetupState | null {
  return getSetupStateFromDb(setupStateJson)
}

export function isOnboardingComplete(setupState: SetupState | null): boolean {
  return isOnboardingCompleteFromDb(setupState)
}

/**
 * Single source of truth for collapsing a stored `useCase` (including the
 * legacy saas/consumer/marketplace values) onto the outcome it should
 * display/behave as. Used by the onboarding picker, board templates, and the
 * launch checklist — previously each had its own copy of this mapping.
 * Returns undefined when unset or unrecognized; callers decide their own default.
 */
export function normalizeOnboardingOutcome(
  useCase?: UseCaseType | null
): OnboardingOutcome | undefined {
  return normalizeOnboardingOutcomeFromDb(useCase)
}
