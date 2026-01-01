/**
 * Roadmap domain module exports
 *
 * IMPORTANT: This barrel export only includes types and error classes.
 * Service functions that access the database are NOT exported here to prevent
 * them from being bundled into the client.
 *
 * For service functions, import directly from './roadmap.service' in server-only code
 * (server functions, API routes, etc.)
 */

// Error classes (no DB dependency)
export { RoadmapError } from './roadmap.errors'
export type { RoadmapErrorCode } from './roadmap.errors'

// Types (no DB dependency)
export type {
  CreateRoadmapInput,
  UpdateRoadmapInput,
  AddPostToRoadmapInput,
  ReorderPostsInput,
  RoadmapPostEntry,
  RoadmapPostsListResult,
  RoadmapPostsQueryOptions,
} from './roadmap.types'
