/**
 * Input/Output types for RoadmapService operations
 */

import type { PostRoadmap } from '@quackback/db/types'
import type { PostId, RoadmapId, StatusId, BoardId } from '@quackback/ids'

/**
 * Input for creating a new roadmap
 */
export interface CreateRoadmapInput {
  name: string
  slug: string
  description?: string
  isPublic?: boolean
}

/**
 * Input for updating an existing roadmap
 */
export interface UpdateRoadmapInput {
  name?: string
  description?: string
  isPublic?: boolean
}

/**
 * Input for adding a post to a roadmap
 */
export interface AddPostToRoadmapInput {
  postId: PostId
  roadmapId: RoadmapId
}

/**
 * Input for reordering posts within a roadmap
 */
export interface ReorderPostsInput {
  roadmapId: RoadmapId
  postIds: PostId[]
}

/**
 * Roadmap post entry for display
 */
export interface RoadmapPostEntry {
  id: PostId
  title: string
  voteCount: number
  statusId: StatusId | null
  board: {
    id: BoardId
    name: string
    slug: string
  }
  roadmapEntry: PostRoadmap
}

/**
 * Result for roadmap post list queries (with roadmap entry data)
 */
export interface RoadmapPostsListResult {
  items: RoadmapPostEntry[]
  total: number
  hasMore: boolean
}

/**
 * Query options for listing roadmap posts
 */
export interface RoadmapPostsQueryOptions {
  statusId?: StatusId
  limit?: number
  offset?: number
}
