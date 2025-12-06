/**
 * Shared constants - used across UI components and server code
 */

/**
 * Available reaction emojis for comments
 */
export const REACTION_EMOJIS = ['👍', '❤️', '🎉', '😄', '🤔', '👀'] as const

/**
 * Type for reaction emoji values
 */
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number]
