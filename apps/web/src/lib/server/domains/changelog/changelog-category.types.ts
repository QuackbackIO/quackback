/**
 * Input/Output types for the changelog categories (labels) domain.
 */
import type { ChangelogCategoryId } from '@quackback/ids'

export interface ChangelogCategory {
  id: ChangelogCategoryId
  name: string
  color: string
  /** Segments this category is gated to; [] = everyone. */
  segmentIds: string[]
  position: number
  createdAt: Date
}

export interface CreateChangelogCategoryInput {
  name: string
  color: string
  segmentIds?: string[]
}

export interface UpdateChangelogCategoryInput {
  name?: string
  color?: string
  segmentIds?: string[]
}
