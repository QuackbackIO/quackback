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
}

/**
 * Input for updating an existing tag
 */
export interface UpdateTagInput {
  name?: string
  color?: string
  description?: string | null
}
