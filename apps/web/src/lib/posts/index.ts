/**
 * Post domain module exports
 *
 * IMPORTANT: This barrel export only includes types and error classes.
 * Service functions that access the database are NOT exported here to prevent
 * them from being bundled into the client.
 *
 * For service functions, import directly from './post.service' or './post.public'
 * in server-only code (server functions, API routes, etc.)
 */

// Error classes (no DB dependency)
export { PostError } from './post.errors'
export type { PostErrorCode } from './post.errors'

// Types (no DB dependency)
export type {
  CreatePostInput,
  UpdatePostInput,
  VoteResult,
  ChangeStatusInput,
  PostWithDetails,
  RoadmapPost,
  RoadmapPostListResult,
  PublicPostDetail,
  PublicComment,
  OfficialResponse,
  PublicPostListResult,
  PublicPostListItem,
  InboxPostListParams,
  InboxPostListResult,
  PostListItem,
  PostForExport,
  CreatePostResult,
  ChangeStatusResult,
} from './post.types'
