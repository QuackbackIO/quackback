/**
 * Input/Output types for TagService operations
 */

/**
 * Input for creating a new tag
 */
export interface CreateTagInput {
  name: string
  color?: string
  description?: string
  /** Matching rule for AI auto-tagging of new posts; unset disables it. */
  aiPrompt?: string
}

/**
 * Input for updating an existing tag
 */
export interface UpdateTagInput {
  name?: string
  color?: string
  description?: string | null
  aiPrompt?: string | null
}
