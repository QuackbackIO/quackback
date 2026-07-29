/**
 * Input/Output types for RoadmapService operations
 */

import type { Roadmap, RoadmapColumn } from '@/lib/server/db'
import type {
  RoadmapId,
  RoadmapColumnId,
  PostStatusId,
  BoardId,
  PostTagId,
  SegmentId,
} from '@quackback/ids'
import type {
  RoadmapBaseFilter,
  RoadmapFrequency,
  RoadmapType,
  RoadmapVisibility,
} from '@/lib/shared/roadmap-config'

export interface RoadmapColumnInput {
  id?: RoadmapColumnId
  statusId: PostStatusId
  name: string
  icon?: string | null
  color: string
  position: number
}

export type RoadmapWithColumns = Roadmap & { columns: RoadmapColumn[] }

/**
 * Input for creating a new roadmap
 */
export interface CreateRoadmapInput {
  name: string
  slug: string
  description?: string
  type?: RoadmapType
  baseFilter?: RoadmapBaseFilter
  dateSource?: 'eta' | null
  frequency?: RoadmapFrequency | null
  visibility?: RoadmapVisibility
  visibleSegmentIds?: SegmentId[] | null
  columns?: RoadmapColumnInput[]
}

/**
 * Input for updating an existing roadmap
 */
export interface UpdateRoadmapInput {
  name?: string
  description?: string | null
  type?: RoadmapType
  baseFilter?: RoadmapBaseFilter
  dateSource?: 'eta' | null
  frequency?: RoadmapFrequency | null
  visibility?: RoadmapVisibility
  visibleSegmentIds?: SegmentId[] | null
  columns?: RoadmapColumnInput[]
}

/**
 * Post returned by a derived roadmap view.
 */
export interface RoadmapViewPost {
  id: import('@quackback/ids').PostId
  title: string
  voteCount: number
  commentCount: number
  statusId: PostStatusId | null
  /** Target ship date (time-based roadmap); serialized across the RPC boundary. */
  eta: Date | string | null
  board: {
    id: BoardId
    name: string
    slug: string
  }
}

/**
 * Result for derived roadmap post list queries.
 */
export interface RoadmapPostsListResult {
  items: RoadmapViewPost[]
  total: number
  hasMore: boolean
}

/**
 * Query options for listing roadmap posts
 */
export interface RoadmapPostsQueryOptions {
  statusId?: PostStatusId
  limit?: number
  offset?: number
  search?: string
  boardIds?: BoardId[]
  tagIds?: PostTagId[]
  segmentIds?: SegmentId[]
  bucketId?: string
  sort?: 'votes' | 'newest' | 'oldest'
}

export interface CreateRoadmapColumnInput {
  roadmapId: RoadmapId
  statusId: PostStatusId
  name: string
  icon?: string | null
  color: string
  position?: number
}

export interface UpdateRoadmapColumnInput {
  name?: string
  icon?: string | null
  color?: string
  position?: number
}
