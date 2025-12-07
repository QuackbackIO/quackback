/**
 * Input/Output types for TagService operations
 */

import type { Tag } from '@quackback/db/types'

/**
 * Input for creating a new tag
 */
export interface CreateTagInput {
  name: string
  color?: string
}

/**
 * Input for updating an existing tag
 */
export interface UpdateTagInput {
  name?: string
  color?: string
}

/**
 * Extended tag with usage statistics
 */
export interface TagWithStats extends Tag {
  postCount?: number
}
