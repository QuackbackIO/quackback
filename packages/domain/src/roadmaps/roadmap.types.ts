/**
 * Input/Output types for RoadmapService operations
 */

import type { Roadmap, PostRoadmap } from '@quackback/db/types'

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
  postId: string
  roadmapId: string
  statusId: string
}

/**
 * Input for moving a post within a roadmap (change status/column)
 */
export interface MovePostInRoadmapInput {
  postId: string
  roadmapId: string
  newStatusId: string
}

/**
 * Input for reordering posts within a roadmap column
 */
export interface ReorderPostsInput {
  roadmapId: string
  statusId: string
  postIds: string[]
}

/**
 * Roadmap with post count per status
 */
export interface RoadmapWithStats extends Roadmap {
  postCounts: Record<string, number>
}

/**
 * Roadmap post entry for display
 */
export interface RoadmapPostEntry {
  id: string
  title: string
  voteCount: number
  board: {
    id: string
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
  statusId?: string
  limit?: number
  offset?: number
}
