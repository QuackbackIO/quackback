/**
 * Post domain module exports
 *
 * IMPORTANT: This barrel export only includes types.
 * Service functions that access the database are NOT exported here to prevent
 * them from being bundled into the client.
 *
 * For service functions, import directly from './post.service' or './post.public'
 * in server-only code (server functions, API routes, etc.)
 */

// Types (no DB dependency)
export type {
  CreatePostInput,
  UpdatePostInput,
  AdminEditPostInput,
  UserEditPostInput,
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
  MergePostInput,
  MergePostResult,
  UnmergePostResult,
  MergedPostSummary,
  PostMergeInfo,
} from './post.types'
