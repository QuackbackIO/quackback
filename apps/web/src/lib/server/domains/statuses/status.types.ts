/**
 * Input/Output types for StatusService operations
 */

import type { PostStatusEntity, StatusCategory } from '@quackback/db/types'
import type { StatusId } from '@quackback/ids'

/**
 * Re-export Status type for convenience
 */
export type Status = PostStatusEntity

/**
 * Input for creating a new status
 */
export interface CreateStatusInput {
  name: string
  slug: string
  color: string
  category: StatusCategory
  position?: number
  showOnRoadmap?: boolean
  isDefault?: boolean
}

/**
 * Input for updating an existing status
 */
export interface UpdateStatusInput {
  name?: string
  color?: string
  showOnRoadmap?: boolean
  isDefault?: boolean
}

/**
 * Input for reordering statuses within a category
 */
export interface ReorderStatusesInput {
  category: StatusCategory
  statusIds: StatusId[]
}
